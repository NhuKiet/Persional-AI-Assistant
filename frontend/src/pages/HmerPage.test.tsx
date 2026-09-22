import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { HmerPage } from "./HmerPage";
import type { HmerStatus } from "../lib/hmerApi";

const STATUS_READY: HmerStatus = {
  configured: true,
  checkpoint: "/models/swincomer.ckpt",
  checkpoint_exists: true,
  loaded: true,
  device: "cuda",
  last_error: null,
};

const STATUS_UNCONFIGURED: HmerStatus = {
  configured: false,
  checkpoint: null,
  checkpoint_exists: false,
  loaded: false,
  device: null,
  last_error: null,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Routes status and recognize independently so each test states only what
 *  it cares about. */
function mockBackend(
  { status = STATUS_READY, recognize = () => json({}) }:
  { status?: HmerStatus; recognize?: () => Response } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/hmer/status")) return json(status);
      if (url.endsWith("/api/hmer/recognize") && init?.method === "POST") {
        return recognize();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter>
      <HmerPage />
    </MemoryRouter>,
  );
}

function upload(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["img"], "bai1.png", { type: "image/png" })] },
  });
}

beforeEach(() => {
  localStorage.clear();
  mockBackend();
});

test("shows the dropzone", async () => {
  renderPage();
  expect(await screen.findByText(/Kéo thả ảnh công thức vào đây/i)).toBeInTheDocument();
});

test("warns up front when no checkpoint is configured", async () => {
  /* The reason must be visible before the user picks a file — otherwise the
     only way to discover a missing checkpoint is to upload and fail. */
  mockBackend({ status: STATUS_UNCONFIGURED });
  renderPage();

  expect(await screen.findByText(/Chưa cấu hình HMER_CHECKPOINT/i)).toBeInTheDocument();
});

test("names the missing file when the checkpoint path is wrong", async () => {
  mockBackend({
    status: { ...STATUS_READY, checkpoint_exists: false, checkpoint: "/wrong/path.ckpt" },
  });
  renderPage();

  expect(await screen.findByText(/\/wrong\/path\.ckpt/)).toBeInTheDocument();
});

test("renders the recognized LaTeX and its metadata", async () => {
  mockBackend({
    recognize: () =>
      json({
        filename: "abc_bai1.png",
        latex: "\\frac { 1 } { 2 }",
        score: -0.42,
        elapsed_ms: 1234,
        device: "cuda",
      }),
  });
  const { container } = renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  upload(container);

  // Scoped to .hmer-code on purpose: KaTeX re-emits the source string inside
  // a MathML <annotation>, so a bare text query matches two elements.
  await waitFor(() =>
    expect(container.querySelector(".hmer-code")).toHaveTextContent(
      "\\frac { 1 } { 2 }",
    ),
  );
  expect(screen.getByText("1234 ms")).toBeInTheDocument();
  expect(screen.getByText("-0.420")).toBeInTheDocument();
  // KaTeX renders into the preview panel rather than leaving raw tokens.
  expect(container.querySelector(".hmer-render .katex")).toBeTruthy();
});

test("surfaces the backend's reason on 503 instead of a status code", async () => {
  /* The 503 body names what an operator must fix. Replacing it with a
     generic failure message is the bug this guards against. */
  mockBackend({
    recognize: () => json({ detail: "Không tìm thấy checkpoint tại '/x.ckpt'" }, 503),
  });
  const { container } = renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  upload(container);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    /Không tìm thấy checkpoint/i,
  );
});

test("reports an empty beam as an outcome, not an error", async () => {
  mockBackend({
    recognize: () =>
      json({ filename: "a.png", latex: "", score: 0, elapsed_ms: 90, device: "cpu" }),
  });
  const { container } = renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  upload(container);

  expect(await screen.findByText(/không đưa ra giả thuyết nào/i)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
