/** Owner login + guest trial, as the user sees it: a guest banner with the
 *  turns left, owner-only tools locked with a way to sign in, a login page,
 *  and nothing of it at all when the backend runs without a password. */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { AUTH_CHANGED } from "../lib/auth";
import { apiFetch } from "../lib/api";
import { displayPdfName } from "../lib/pdfUrls";
import { readErrorResponse } from "../lib/sse";

const GUEST = { role: "guest", auth: true, guest: { enabled: true, limit: 10, remaining: 7, tools: ["chat", "pdf", "hmer"] } };
const OWNER = { role: "owner", auth: true, guest: GUEST.guest };
const OPEN = { role: "owner", auth: false, guest: null };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

/** `me` is read on every /api/auth/me call, so a test can change who we are. */
function installBackend(initial: unknown) {
  const state = { me: initial, password: "dung-mat-khau" };
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/auth/me")) return json(state.me);
    if (url.endsWith("/api/auth/login")) {
      const { password } = JSON.parse(String(init?.body));
      if (password !== state.password) return json({ detail: "wrong_password", message: "Sai mật khẩu." }, 401);
      state.me = OWNER;
      return json(OWNER);
    }
    if (url.endsWith("/api/auth/logout")) {
      state.me = GUEST;
      return json(GUEST);
    }
    if (url.endsWith("/api/models")) return json({ models: [], default: null });
    return json({});
  }));
  return { state, calls };
}

function openAt(path: string) {
  window.history.pushState({}, "", path);
  render(<App />);
}

afterEach(() => vi.unstubAllGlobals());

describe("guest", () => {
  it("sees how many trial turns are left, with a way to sign in", async () => {
    installBackend(GUEST);
    openAt("/chat");

    const banner = await screen.findByRole("status", { name: "Chế độ dùng thử" });
    expect(banner).toHaveTextContent("còn 7/10 lượt hôm nay");
    expect(within(banner).getByRole("link", { name: "Đăng nhập" })).toHaveAttribute("href", "/login?next=%2Fchat");
  });

  it("finds owner-only tools locked, with a way in", async () => {
    installBackend(GUEST);
    openAt("/research");

    expect(await screen.findByRole("heading", { name: "Research cần đăng nhập" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Đăng nhập" })).toHaveAttribute("href", "/login?next=%2Fresearch");
    expect(screen.queryByPlaceholderText(/Nhập chủ đề nghiên cứu/i)).toBeNull();
  });

  it("sees owner-only tools marked on the chat page", async () => {
    installBackend(GUEST);
    openAt("/chat");

    const research = await screen.findByTitle(/Deep research/i);
    await waitFor(() => expect(research).toHaveAccessibleName(/Research.*cần đăng nhập/));
  });
});

describe("login", () => {
  it("says so when the password is wrong", async () => {
    installBackend(GUEST);
    openAt("/login?next=/research");

    await userEvent.type(await screen.findByLabelText("Mật khẩu"), "sai{Enter}");

    expect(await screen.findByText("Sai mật khẩu.")).toBeInTheDocument();
  });

  it("signs in and goes where the user was headed, as the owner", async () => {
    installBackend(GUEST);
    openAt("/login?next=/research");

    await userEvent.type(await screen.findByLabelText("Mật khẩu"), "dung-mat-khau{Enter}");

    expect(await screen.findByPlaceholderText(/Nhập chủ đề nghiên cứu/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/research");
    expect(screen.queryByRole("status", { name: "Chế độ dùng thử" })).toBeNull();
  });

  it("lets the owner sign out from the sidebar", async () => {
    const backend = installBackend(OWNER);
    openAt("/chat");

    await userEvent.click(await screen.findByRole("button", { name: "Đăng xuất" }));

    expect(backend.calls.some(c => c.url.endsWith("/api/auth/logout") && c.init?.method === "POST")).toBe(true);
    expect(await screen.findByRole("status", { name: "Chế độ dùng thử" })).toBeInTheDocument();
  });
});

describe("open mode (no password on the backend)", () => {
  it("shows no banner, no lock and no sign-in", async () => {
    installBackend(OPEN);
    openAt("/research");

    expect(await screen.findByPlaceholderText(/Nhập chủ đề nghiên cứu/i)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Chế độ dùng thử" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Đăng xuất" })).toBeNull();
  });
});

describe("plumbing", () => {
  it("asks who we are again after a trial turn", async () => {
    installBackend(GUEST);
    const heard = vi.fn();
    window.addEventListener(AUTH_CHANGED, heard);

    await apiFetch("/api/chat/stream", { method: "POST", body: "{}" });
    await apiFetch("/api/models");

    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_CHANGED, heard);
  });

  it("shows the readable message of an auth error, not its code", async () => {
    const message = await readErrorResponse(json({ detail: "guest_quota_exceeded", message: "Hết lượt dùng thử hôm nay." }, 429));

    expect(message).toBe("Hết lượt dùng thử hôm nay.");
  });

  it("hides the random prefix of a guest's PDF name", () => {
    expect(displayPdfName("0123456789abcdef_bai-giang.pdf")).toBe("bai-giang.pdf");
    expect(displayPdfName("bao-cao.pdf")).toBe("bao-cao.pdf");
  });
});
