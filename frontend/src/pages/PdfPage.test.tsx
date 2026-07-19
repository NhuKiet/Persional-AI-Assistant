import { forwardRef, useImperativeHandle, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFPage } from "./PdfPage";

const viewerHandle = vi.hoisted(() => ({
  scrollToPage: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  fitWidth: vi.fn(),
  highlightExcerpt: vi.fn(),
}));

vi.mock("../components/pdf/PdfViewer", () => ({
  default: forwardRef(function FakePdfViewer(props: any, ref) {
    const [error, setError] = useState(false);
    useImperativeHandle(ref, () => viewerHandle);
    const pdf = {
      numPages: 7,
      getOutline: async () => [],
      getPage: vi.fn(),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(),
    };
    return (
      <div data-testid="fake-pdf-viewer">
        <button type="button" onClick={() => props.onDocumentReady?.(pdf, 7)}>
          Hoàn tất tải PDF
        </button>
        <button
          type="button"
          onClick={() => {
            setError(true);
            props.onDocumentError?.(new Error("worker failed"));
          }}
        >
          Gây lỗi viewer
        </button>
        {error ? <p>Không render được PDF. Vẫn có thể chat bằng text.</p> : null}
      </div>
    );
  }),
}));

vi.mock("../components/pdf/SelectionLayer", () => ({
  default: ({ children, onPin }: any) => (
    <div>
      <button
        type="button"
        onClick={() => onPin({ type: "text", page: 2, text: "Ngữ cảnh ghim" }, "pin")}
      >
        Thêm ghim kiểm thử
      </button>
      {children}
    </div>
  ),
}));

type FetchScenario = {
  stream?: Response | (() => Promise<Response>);
  summarize?: Response;
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function installFetch(scenario: FetchScenario = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/models")) return jsonResponse({ models: [], default: null });
    if (url.endsWith("/api/pdf/upload") && init?.method === "POST") {
      return jsonResponse({ filename: "doc.pdf", total_pages: 99, total_chars: 3400 });
    }
    if (url.endsWith("/api/pdf/stream") && init?.method === "POST") {
      const response = scenario.stream ?? sseResponse([{ type: "done", message: "done" }]);
      return typeof response === "function" ? response() : response;
    }
    if (url.endsWith("/api/pdf/summarize") && init?.method === "POST") {
      return scenario.summarize ?? sseResponse([{ type: "done", message: "done" }]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

async function renderUploadedPdf(width = 1400) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  const rendered = render(<MemoryRouter><PDFPage /></MemoryRouter>);
  const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, {
    target: { files: [new File(["pdf"], "doc.pdf", { type: "application/pdf" })] },
  });
  expect(await screen.findAllByText("doc.pdf")).not.toHaveLength(0);
  return rendered;
}

async function sendQuestion(question = "Câu hỏi thử", waitForQuestion = true) {
  const user = userEvent.setup();
  const input = screen.getByPlaceholderText("Hỏi về nội dung PDF…");
  await user.type(input, question);
  await user.click(screen.getByRole("button", { name: "Gửi" }));
  if (waitForQuestion) await screen.findByText(question);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("PDF workspace stream integration", () => {
  it("uses PDF.js page count and keeps a generic viewer failure inside the workspace", async () => {
    installFetch();
    await renderUploadedPdf();

    await userEvent.click(screen.getByRole("button", { name: "Hoàn tất tải PDF" }));
    expect(screen.getByText("7 trang · 3.4K ký tự")).toBeInTheDocument();
    expect(screen.getByText("/ 7")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Gây lỗi viewer" }));
    expect(screen.getByText(/Vẫn có thể chat bằng text/)).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Trợ lý tài liệu" })).toBeInTheDocument();
  });

  it("keeps a pin and user question when chat returns 409 before SSE", async () => {
    installFetch({ stream: new Response("not SSE", { status: 409 }) });
    await renderUploadedPdf();
    await userEvent.click(screen.getByRole("button", { name: "Thêm ghim kiểm thử" }));

    await sendQuestion();

    expect(await screen.findByText(/Phiên đang bận/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bỏ ghim trang 2" })).toBeInTheDocument();
    expect(screen.getByText("Câu hỏi thử")).toBeInTheDocument();
  });

  it("retains pins on stream error but clears them only after done", async () => {
    installFetch({
      stream: sseResponse([{ type: "error", message: "Không thể trả lời" }]),
    });
    await renderUploadedPdf();
    await userEvent.click(screen.getByRole("button", { name: "Thêm ghim kiểm thử" }));
    await sendQuestion("Lần lỗi");

    expect(await screen.findByText(/Không thể trả lời/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bỏ ghim trang 2" })).toBeInTheDocument();

    installFetch({ stream: sseResponse([{ type: "token", content: "Được" }, { type: "done", message: "done" }]) });
    await sendQuestion("Lần thành công");

    await screen.findByText("Được");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Bỏ ghim trang 2" })).not.toBeInTheDocument();
    });
  });

  it("applies sources through the stream state and closes the narrow assistant when opened", async () => {
    installFetch({
      stream: sseResponse([
        { type: "sources", sources: [{ page: 4, chunk_index: 2, excerpt: "Đoạn nguồn" }] },
        { type: "token", content: "Câu trả lời" },
        { type: "done", message: "done" },
      ]),
    });
    await renderUploadedPdf(375);
    await userEvent.click(screen.getByRole("button", { name: "Hỏi tài liệu" }));
    await sendQuestion();

    await userEvent.click(await screen.findByRole("button", { name: "Trang 4 · Nguồn 1" }));

    expect(viewerHandle.highlightExcerpt).toHaveBeenCalledWith(4, "Đoạn nguồn");
    expect(screen.queryByRole("complementary", { name: "Trợ lý tài liệu" })).not.toBeInTheDocument();
  });

  it("returns to upload with a fresh persisted session only for pdf_not_found", async () => {
    localStorage.setItem("king_sid_pdf", "old-session");
    installFetch({
      stream: sseResponse([{ type: "error", code: "pdf_not_found", message: "PDF missing" }]),
    });
    await renderUploadedPdf();

    await sendQuestion("Câu hỏi thử", false);

    expect(await screen.findByText("Kéo thả file PDF vào đây")).toBeInTheDocument();
    expect(localStorage.getItem("king_sid_pdf")).not.toBe("old-session");
    expect(screen.queryByText("Câu hỏi thử")).not.toBeInTheDocument();
  });

  it("keeps summarize-specific scope rejection separate from chat events", async () => {
    installFetch({
      summarize: sseResponse([{
        type: "pdf.summary_scope_rejected",
        message: "Tài liệu vượt giới hạn tóm tắt",
      }]),
    });
    await renderUploadedPdf();

    await userEvent.click(screen.getByRole("button", { name: "Tóm tắt" }));

    expect(await screen.findByText("Tài liệu vượt giới hạn tóm tắt")).toBeInTheDocument();
  });
});
