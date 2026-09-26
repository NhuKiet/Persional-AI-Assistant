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

const EXPLANATION = {
  tokens: ["x", "^", "{", "2", "}"],
  token_probs: [0.9, 1, 1, 0.8, 1],
  evidence: {
    rows: 1,
    cols: 2,
    weights: [[1, 0], [0, 0], [0, 0], [0, 1], [0, 0]],
    no_evidence: [false, true, true, false, true],
  },
  elapsed_ms: 1500,
};

/** Routes status, recognize and explain independently so each test states
 *  only what it cares about. Explain request bodies are recorded. */
function mockBackend(
  {
    status = STATUS_READY,
    recognize = () => json({}),
    explain = () => json(EXPLANATION),
  }: {
    status?: HmerStatus;
    recognize?: (init?: RequestInit) => Response;
    explain?: () => Response;
  } = {},
) {
  const explainCalls: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/hmer/status")) return json(status);
      if (url.endsWith("/api/hmer/recognize") && init?.method === "POST") {
        return recognize(init);
      }
      if (url.endsWith("/api/hmer/explain") && init?.method === "POST") {
        explainCalls.push(JSON.parse(String(init.body)));
        return explain();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
  return { explainCalls };
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

  // The editable LaTeX box starts with exactly what the model read.
  await waitFor(() =>
    expect(container.querySelector(".hmer-code")).toHaveValue("\\frac { 1 } { 2 }"),
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
    expect(container.querySelector(".hmer-code")).toHaveValue("x ^ { 2 }"),
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
    expect(container.querySelector(".hmer-code")).toHaveValue("x ^ { 2 }"),
  );
  expect(sent).toBeInstanceOf(File);
  expect((sent as unknown as File).name).toBe("ve-tay.png");
});

test("asks for the evidence map once, with the filename and LaTeX recognize returned", async () => {
  const { explainCalls } = mockBackend({ recognize: () => json(RESULT) });
  const { container } = renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  upload(container);

  // The chips only exist once the map has arrived.
  expect(await screen.findByRole("toolbar", { name: /Các ký hiệu/ })).toBeInTheDocument();
  expect(explainCalls).toEqual([{ filename: RESULT.filename, latex: RESULT.latex }]);
});

test("does not ask for a map when the model produced no LaTeX", async () => {
  const { explainCalls } = mockBackend({
    recognize: () => json({ filename: "a.png", latex: "", score: 0, elapsed_ms: 90, device: "cpu" }),
  });
  const { container } = renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  upload(container);

  await screen.findByText(/không đưa ra giả thuyết nào/i);
  expect(explainCalls).toEqual([]);
});

test("keeps the LaTeX when the evidence map fails", async () => {
  mockBackend({
    recognize: () => json(RESULT),
    explain: () => json({ detail: "CUDA out of memory" }, 500),
  });
  const { container } = renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  upload(container);

  expect(await screen.findByText(/Không tính được vùng mô hình dựa vào/)).toHaveTextContent(/CUDA/);
  expect(container.querySelector(".hmer-code")).toHaveValue("x ^ { 2 }");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});


// ── Fixing the result by hand ───────────────────────────────────────────────
// The model reads about half of all expressions correctly, so a wrong symbol
// has to be fixable in place rather than only copyable.

const RESULT_7 = { ...RESULT, latex: "x ^ { 7 }" };
const DOUBTFUL_EXPLANATION = {
  ...EXPLANATION,
  tokens: ["x", "^", "{", "7", "}"],
  token_probs: [0.95, 0.9, 1, 0.31, 1],
};

async function recognizeOnce(result = RESULT, explanation = EXPLANATION) {
  mockBackend({ recognize: () => json(result), explain: () => json(explanation) });
  const view = renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);
  upload(view.container);
  const box = (await screen.findByRole("textbox", { name: /LaTeX/ })) as HTMLTextAreaElement;
  return { ...view, box };
}

test("re-renders the preview from the edited LaTeX and copies the edit", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const { container, box } = await recognizeOnce();

  fireEvent.change(box, { target: { value: "x ^ { 3 }" } });

  // KaTeX keeps its source in a MathML annotation: the preview follows the box.
  expect(container.querySelector(".hmer-render annotation")).toHaveTextContent("x ^ { 3 }");
  fireEvent.click(screen.getByRole("button", { name: "Chép LaTeX" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("x ^ { 3 }"));
});

test("restores the model's reading after an edit", async () => {
  const { box } = await recognizeOnce();
  expect(screen.queryByRole("button", { name: /Khôi phục/ })).toBeNull();

  fireEvent.change(box, { target: { value: "y" } });
  fireEvent.click(screen.getByRole("button", { name: /Khôi phục/ }));

  expect(box).toHaveValue("x ^ { 2 }");
  expect(screen.queryByRole("button", { name: /Khôi phục/ })).toBeNull();
});

test("says the box is empty rather than blaming the model when it is cleared", async () => {
  const { box } = await recognizeOnce();

  fireEvent.change(box, { target: { value: "  " } });

  expect(screen.getByText(/Ô LaTeX đang trống/)).toBeInTheDocument();
  expect(screen.queryByText(/không đưa ra giả thuyết nào/i)).toBeNull();
});

test("points at the symbol the model was least sure of and selects it", async () => {
  const { box } = await recognizeOnce(RESULT_7, DOUBTFUL_EXPLANATION);

  fireEvent.click(await screen.findByRole("button", { name: /Chọn ký hiệu 7/ }));

  // "x ^ { 7 }": the 7 sits at index 6.
  expect([box.selectionStart, box.selectionEnd]).toEqual([6, 7]);
  expect(document.activeElement).toBe(box);
});

test("still finds a doubtful symbol after the text around it changed", async () => {
  const { box } = await recognizeOnce(RESULT_7, DOUBTFUL_EXPLANATION);
  const chip = await screen.findByRole("button", { name: /Chọn ký hiệu 7/ });

  fireEvent.change(box, { target: { value: "2 x ^ { 7 }" } });
  fireEvent.click(chip);

  expect([box.selectionStart, box.selectionEnd]).toEqual([8, 9]);
});

test("lists no doubtful symbols when the model was sure of every one", async () => {
  await recognizeOnce(); // EXPLANATION: every probability ≥ 0.8
  await screen.findByRole("toolbar", { name: /Các ký hiệu/ });

  expect(screen.queryByText(/Mô hình ít chắc/)).toBeNull();
});

test("flags doubtful symbols in the evidence strip too", async () => {
  const { container } = await recognizeOnce(RESULT_7, DOUBTFUL_EXPLANATION);
  await screen.findByRole("toolbar", { name: /Các ký hiệu/ });

  const flagged = [...container.querySelectorAll(".hmer-token.is-doubtful")];
  expect(flagged.map((n) => n.getAttribute("aria-label"))).toEqual([
    expect.stringMatching(/^7, /),
  ]);
});

// ── Pasting an image ────────────────────────────────────────────────────────

function paste(files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  document.body.dispatchEvent(event);
  return event;
}

test("recognizes an image pasted with Ctrl+V", async () => {
  const sent: File[] = [];
  mockBackend({
    recognize: (init) => {
      sent.push((init?.body as FormData).get("file") as File);
      return json(RESULT);
    },
  });
  renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  const event = paste([new File(["png"], "image.png", { type: "image/png" })]);

  expect(event.defaultPrevented).toBe(true);
  expect(await screen.findByRole("textbox", { name: /LaTeX/ })).toHaveValue("x ^ { 2 }");
  expect(sent).toHaveLength(1);
  expect(sent[0].type).toBe("image/png");
  expect(sent[0].name).toMatch(/^[\w-]+\.png$/);
});

test("refuses a pasted image format the model cannot read", async () => {
  const recognize = vi.fn(() => json(RESULT));
  mockBackend({ recognize });
  renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  paste([new File(["gif"], "a.gif", { type: "image/gif" })]);

  expect(await screen.findByRole("alert")).toHaveTextContent(/PNG, JPG hoặc BMP/);
  expect(recognize).not.toHaveBeenCalled();
});

test("leaves a plain-text paste alone", async () => {
  const recognize = vi.fn(() => json(RESULT));
  mockBackend({ recognize });
  renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  const event = paste([]);

  expect(event.defaultPrevented).toBe(false);
  expect(recognize).not.toHaveBeenCalled();
});


test("shows the model's matrix output as valid LaTeX, but explains the raw tokens", async () => {
  const raw = String.raw`\ { \begin { m a t r i x } 2 \ \ 7 \end { m a t r i x } \ }`;
  const readable = String.raw`\{ \begin{matrix} 2 \\ 7 \end{matrix} \}`;
  const { explainCalls } = mockBackend({ recognize: () => json({ ...RESULT, latex: raw }) });
  const { container } = renderPage();
  await screen.findByText(/Kéo thả ảnh công thức vào đây/i);

  upload(container);

  const box = await screen.findByRole("textbox", { name: /LaTeX/ });
  expect(box).toHaveValue(readable);
  expect(container.querySelector(".hmer-render .katex")).toBeTruthy();
  expect(screen.queryByText(/Không dựng được công thức/)).toBeNull();
  // Restoring goes back to the readable version, not the raw tokens.
  fireEvent.change(box, { target: { value: "2 + 3" } });
  fireEvent.click(screen.getByRole("button", { name: /Khôi phục/ }));
  expect(box).toHaveValue(readable);
  await waitFor(() => expect(explainCalls).toHaveLength(1));
  expect(explainCalls[0]).toMatchObject({ latex: raw });
});
