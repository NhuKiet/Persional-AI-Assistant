import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodingPage } from "./CodingPage";

function executor(overrides: Record<string, unknown> = {}) {
  return {
    executor: {
      available: false,
      reason: "docker_unavailable",
      image: "king-executor:latest",
      timeout_s: 30,
      memory: "512m",
      network: false,
      ...overrides,
    },
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers /api/coding/status with each of `answers` in turn (the last one
 *  repeats), and `{}` for anything else the page asks for. */
function installFetch(...answers: unknown[]) {
  const statusCalls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/coding/status")) {
      statusCalls.push(url);
      return json(answers[Math.min(statusCalls.length, answers.length) - 1]);
    }
    if (url.endsWith("/api/models")) return json({ models: [], default: null });
    return json({});
  }));
  return statusCalls;
}

function renderPage() {
  return render(<MemoryRouter><CodingPage /></MemoryRouter>);
}

afterEach(() => vi.unstubAllGlobals());

describe("Coding page — sandbox status", () => {
  it("says up front that code can't run while Docker is off", async () => {
    installFetch(executor());
    renderPage();

    expect(await screen.findByText("Chưa chạy được code: Docker chưa bật.")).toBeInTheDocument();
    expect(screen.getByText(/vẫn lên kế hoạch và viết code/)).toBeInTheDocument();
  });

  it("checks again on request and drops the warning once Docker is up", async () => {
    const calls = installFetch(executor(), executor({ available: true, reason: "ok" }));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Kiểm tra lại" }));

    expect(await screen.findByText("Sandbox")).toBeInTheDocument();
    expect(screen.queryByText(/Docker chưa bật/)).toBeNull();
    expect(calls[calls.length - 1]).toMatch(/refresh=true/);
  });

  it("gives the build command when the sandbox image is missing", async () => {
    installFetch(executor({ reason: "image_missing" }));
    renderPage();

    expect(await screen.findByText("docker build -f Dockerfile.executor -t king-executor:latest .")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chép" })).toBeInTheDocument();
  });

  it("shows the limits every run gets when the sandbox is up", async () => {
    installFetch(executor({ available: true, reason: "ok" }));
    renderPage();

    const badge = (await screen.findByText("Sandbox")).closest(".sandbox-badge")!;
    expect(badge).toHaveTextContent("không có mạng · tối đa 30 giây");
    expect(badge).toHaveAttribute("title", "Code chạy trong container Docker cách ly: không có mạng, tối đa 30 giây, 512 MB RAM.");
    expect(screen.queryByRole("button", { name: "Kiểm tra lại" })).toBeNull();
  });

  it("doesn't warn in Quick chat, which never runs code", async () => {
    installFetch(executor());
    renderPage();
    await screen.findByText(/Docker chưa bật/);

    await userEvent.click(screen.getByRole("button", { name: /Quick chat/ }));

    expect(screen.queryByText(/Docker chưa bật/)).toBeNull();
  });

  it("stays quiet when the status can't be read", async () => {
    installFetch({});
    renderPage();
    await screen.findByPlaceholderText("Mô tả task cần làm (Python)…");

    expect(screen.queryByText(/Docker chưa bật/)).toBeNull();
    expect(screen.queryByText("Sandbox")).toBeNull();
  });
});
