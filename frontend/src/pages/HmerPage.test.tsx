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
  { status?: HmerStatus; recognize?: (init?: RequestInit) => Response } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/hmer/status")) return json(status);
      if (url.endsWith("/api/hmer/recognize") && init?.method === "POST") {
        return recognize(init);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

/** Enough of a 2D context for the ink pad to preview and export: jsdom has
 *  no canvas, and setup.js makes getContext return null. */
function mockCanvas() {
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context as unknown as RenderingContext,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function toBlob(callback) {
    callback(new Blob(["png"], { type: "image/png" }));
  });
}

const RESULT = {
  filename: "abc_ve-tay.png",
  latex: "x ^ { 2 }",
  score: -0.2,
  elapsed_ms: 5500,
  device: "cuda:0",
};

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

test("switches between uploading and drawing, keeping the upload path intact", async () => {
  mockCanvas();
  mockBackend({ recognize: () => json(RESULT) });
  const { container } = renderPage();
  const uploadTab = await screen.findByRole("tab", { name: "Tải ảnh" });
  const drawTab = screen.getByRole("tab", { name: "Vẽ tay" });

  expect(uploadTab).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText(/Kéo thả ảnh công thức vào đây/i)).toBeVisible();
  expect(screen.getByLabelText(/Khung vẽ công thức/i)).not.toBeVisible();

  fireEvent.click(drawTab);
  expect(drawTab).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText(/Khung vẽ công thức/i)).toBeVisible();
  expect(screen.getByText(/Kéo thả ảnh công thức vào đây/i)).not.toBeVisible();

  fireEvent.click(uploadTab);
  upload(container);
  await waitFor(() =>
    expect(container.querySelector(".hmer-code")).toHaveTextContent("x ^ { 2 }"),
  );
});

test("moves between the two tabs with the arrow keys", async () => {
  mockCanvas();
  renderPage();
  const uploadTab = await screen.findByRole("tab", { name: "Tải ảnh" });
  const drawTab = screen.getByRole("tab", { name: "Vẽ tay" });

  uploadTab.focus();
  fireEvent.keyDown(uploadTab, { key: "ArrowRight" });
  expect(drawTab).toHaveAttribute("aria-selected", "true");
  expect(drawTab).toHaveFocus();

  fireEvent.keyDown(drawTab, { key: "ArrowLeft" });
  expect(uploadTab).toHaveAttribute("aria-selected", "true");
  expect(uploadTab).toHaveFocus();
});

test("recognizes a drawing through the same endpoint as an upload", async () => {
  mockCanvas();
  let sent: FormDataEntryValue | null = null;
  mockBackend({
    recognize: (init) => {
      sent = (init?.body as FormData).get("file");
      return json(RESULT);
    },
  });
  const { container } = renderPage();
  fireEvent.click(await screen.findByRole("tab", { name: "Vẽ tay" }));

  const pad = screen.getByLabelText(/Khung vẽ công thức/i);
  fireEvent.pointerDown(pad, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 40, clientY: 60 });
  fireEvent.pointerMove(pad, { pointerId: 1, pointerType: "mouse", clientX: 140, clientY: 60 });
  fireEvent.pointerUp(pad, { pointerId: 1, pointerType: "mouse", clientX: 140, clientY: 60 });
  fireEvent.click(screen.getByRole("button", { name: "Nhận dạng" }));

  await waitFor(() =>
    expect(container.querySelector(".hmer-code")).toHaveTextContent("x ^ { 2 }"),
  );
  expect(sent).toBeInstanceOf(File);
  expect((sent as unknown as File).name).toBe("ve-tay.png");
});
