import { describe, expect, it } from "vitest";
import { applyPdfStreamEvent } from "./pdfStreamState";
import type { ChatMessage } from "../types";

describe("applyPdfStreamEvent", () => {
  const initial: ChatMessage[] = [{ role: "assistant", content: "", id: 9 }];

  it("attaches sources to the active assistant message", () => {
    const next = applyPdfStreamEvent(initial, 9, {
      type: "sources",
      sources: [{ page: 15, chunk_index: 2, excerpt: "Embeddings" }],
    });

    expect(next[0].sources).toEqual([
      { page: 15, chunk_index: 2, excerpt: "Embeddings" },
    ]);
  });

  it("appends token content without dropping sources", () => {
    const withSources = applyPdfStreamEvent(initial, 9, {
      type: "sources",
      sources: [{ page: 15, chunk_index: 2, excerpt: "Embeddings" }],
    });
    const next = applyPdfStreamEvent(withSources, 9, { type: "token", content: "Answer" });

    expect(next[0].content).toBe("Answer");
    expect(next[0].sources).toHaveLength(1);
  });

  it("appends an error after streamed content", () => {
    const next = applyPdfStreamEvent(
      [{ role: "assistant", content: "Partial answer", id: 9 }],
      9,
      { type: "error", message: "Kết nối bị gián đoạn" },
    );

    expect(next[0].content).toBe("Partial answer\n\n⚠️ Kết nối bị gián đoạn");
  });

  it("leaves messages unchanged when the stream is done", () => {
    expect(applyPdfStreamEvent(initial, 9, { type: "done", message: "done" })).toBe(initial);
  });
});
