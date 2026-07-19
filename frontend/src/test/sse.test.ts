import { describe, expect, it } from "vitest";
import { parseSSE, readErrorResponse } from "../lib/sse";

/** Feeds a fixed sequence of byte chunks out of a ReadableStream, one
 *  controller.enqueue() per chunk — mirrors how fetch() delivers network
 *  chunks that can split at arbitrary byte boundaries. */
function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: { event: string; data: string }[] = [];
  for await (const ev of parseSSE(stream)) out.push(ev);
  return out;
}

describe("parseSSE", () => {
  // One logical event: an "event:" field, two "data:" lines (joined by \n
  // per the SSE spec), and a multi-byte UTF-8 emoji to exercise decoder
  // buffering across chunk boundaries.
  const message = "event: token\ndata: line one\ndata: line two — emoji 🎉\n\n";
  const bytes = new TextEncoder().encode(message);
  const expected = [{ event: "token", data: "line one\nline two — emoji 🎉" }];

  it("parses a single unsplit chunk", async () => {
    const result = await collect(streamFromChunks([bytes]));
    expect(result).toEqual(expected);
  });

  it("parses identically no matter where the stream is split into two chunks — every byte boundary, including mid-UTF-8", async () => {
    for (let i = 1; i < bytes.length; i++) {
      const chunks = [bytes.slice(0, i), bytes.slice(i)];
      const result = await collect(streamFromChunks(chunks));
      expect(result).toEqual(expected);
    }
  });

  it("parses correctly when every chunk is a single byte (worst-case fragmentation)", async () => {
    const chunks = Array.from(bytes, (b) => new Uint8Array([b]));
    const result = await collect(streamFromChunks(chunks));
    expect(result).toEqual(expected);
  });

  it("flushes the decoder at EOF so a chunk boundary mid-multi-byte-character still decodes correctly", async () => {
    const msg = "data: 🎉\n\n";
    const msgBytes = new TextEncoder().encode(msg);
    // "data: " is 6 ASCII bytes, then the 4-byte 🎉 sequence starts — split
    // after 2 of those 4 bytes so the last chunk starts mid-character.
    const splitAt = 6 + 2;
    const chunks = [msgBytes.slice(0, splitAt), msgBytes.slice(splitAt)];
    const result = await collect(streamFromChunks(chunks));
    expect(result).toEqual([{ event: "message", data: "🎉" }]);
  });

  it("defaults event type to 'message' when no event: field is present", async () => {
    const result = await collect(streamFromChunks([new TextEncoder().encode("data: hello\n\n")]));
    expect(result).toEqual([{ event: "message", data: "hello" }]);
  });

  it("ignores comment lines starting with ':'", async () => {
    const msg = ": keep-alive\ndata: hi\n\n";
    const result = await collect(streamFromChunks([new TextEncoder().encode(msg)]));
    expect(result).toEqual([{ event: "message", data: "hi" }]);
  });

  it("never parses an incomplete trailing event that never received its terminating blank line", async () => {
    const msg = "data: full event\n\ndata: partial no terminator";
    const result = await collect(streamFromChunks([new TextEncoder().encode(msg)]));
    expect(result).toEqual([{ event: "message", data: "full event" }]);
  });

  it("parses multiple events delivered in one stream", async () => {
    const msg = "data: one\n\ndata: two\n\n";
    const result = await collect(streamFromChunks([new TextEncoder().encode(msg)]));
    expect(result).toEqual([
      { event: "message", data: "one" },
      { event: "message", data: "two" },
    ]);
  });
});

describe("readErrorResponse", () => {
  it("extracts the detail field from a JSON error body", async () => {
    const res = new Response(JSON.stringify({ detail: "bad request" }), { status: 400 });
    expect(await readErrorResponse(res)).toBe("bad request");
  });

  it("falls back to the raw text body when it isn't JSON", async () => {
    const res = new Response("something broke", { status: 500 });
    expect(await readErrorResponse(res)).toBe("something broke");
  });

  it("falls back to a generic message when the body is empty", async () => {
    const res = new Response("", { status: 503 });
    expect(await readErrorResponse(res)).toBe("Backend error 503");
  });
});
