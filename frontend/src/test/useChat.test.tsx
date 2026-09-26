/**
 * useChat must never leave the assistant bubble silently empty: an SSE
 * `error` event (e.g. the history DB is down) has to reach the user, and so
 * does a stream that closes without producing a single token.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChat } from "../hooks/useChat";

function sseBody(...events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      controller.close();
    },
  });
}

function mockStream(body: ReadableStream<Uint8Array>) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    { ok: true, status: 200, body } as unknown as Response,
  );
}

async function sendAndGetReply(text = "hello") {
  const { result } = renderHook(() => useChat("chat", "s1"));
  await act(async () => { await result.current.send(text); });
  const assistant = result.current.messages.filter(m => m.role === "assistant");
  expect(assistant).toHaveLength(1);
  return { reply: assistant[0].content, streaming: result.current.streaming };
}

describe("useChat — error events are shown, not swallowed", () => {
  it("shows the backend's error message when the stream fails before any token", async () => {
    mockStream(sseBody({
      type: "error", code: "storage_unavailable", message: "Không thể kết nối kho lịch sử.",
    }));

    const { reply, streaming } = await sendAndGetReply();

    expect(reply).toContain("Không thể kết nối kho lịch sử.");
    expect(streaming).toBe(false);
  });

  it("keeps the partial answer and appends the error when the stream fails mid-way", async () => {
    mockStream(sseBody(
      { type: "token", content: "2 + 2 = 4." },
      { type: "error", message: "Câu trả lời chưa được lưu." },
    ));

    const { reply } = await sendAndGetReply();

    expect(reply.startsWith("2 + 2 = 4.")).toBe(true);
    expect(reply).toContain("Câu trả lời chưa được lưu.");
  });

  it("falls back to a generic notice when the error event carries no message", async () => {
    mockStream(sseBody({ type: "error" }));

    const { reply } = await sendAndGetReply();

    expect(reply.trim()).not.toBe("");
    expect(reply).toContain("⚠️");
  });

  it("tells the user when the stream ends without any token or error", async () => {
    mockStream(sseBody());

    const { reply } = await sendAndGetReply();

    expect(reply.trim()).not.toBe("");
    expect(reply).toContain("⚠️");
  });

  it("leaves a normal answer untouched", async () => {
    mockStream(sseBody({ type: "token", content: "Xin " }, { type: "token", content: "chào" }));

    const { reply } = await sendAndGetReply();

    expect(reply).toBe("Xin chào");
  });
});

/** One reply per request, in order; records every request body. */
function mockReplies(...replies: string[]) {
  const bodies: Record<string, unknown>[] = [];
  let call = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const reply = replies[Math.min(call++, replies.length - 1)];
    return { ok: true, status: 200, body: sseBody({ type: "token", content: reply }) } as unknown as Response;
  });
  return bodies;
}

const turns = (messages: { role: string; content: string }[]) => messages.map(m => [m.role, m.content]);
const MODEL = { provider: "openai", model: "gpt-4o-mini" };

describe("useChat — regenerate and edit the last question", () => {
  it("regenerates the last answer from the same question, with the same context", async () => {
    const bodies = mockReplies("Trả lời 1", "Trả lời 2");
    const { result } = renderHook(() => useChat("chat", "s1"));
    await act(async () => { await result.current.send("hello", "ngữ cảnh", null, "rag-1", MODEL); });

    await act(async () => { await result.current.regenerate(MODEL); });

    expect(turns(result.current.messages)).toEqual([["user", "hello"], ["assistant", "Trả lời 2"]]);
    expect(bodies[0]).toMatchObject({ replace_last: false });
    expect(bodies[1]).toMatchObject({
      message: "hello", replace_last: true, context: "ngữ cảnh", rag_session_id: "rag-1", model: "gpt-4o-mini",
    });
  });

  it("replaces the last question with the edited one and answers it", async () => {
    const bodies = mockReplies("Trả lời 1", "Trả lời 2");
    const { result } = renderHook(() => useChat("chat", "s1"));
    await act(async () => { await result.current.send("hello"); });

    await act(async () => { await result.current.editLast("hello 2", MODEL); });

    expect(turns(result.current.messages)).toEqual([["user", "hello 2"], ["assistant", "Trả lời 2"]]);
    expect(bodies[1]).toMatchObject({ message: "hello 2", replace_last: true });
  });

  it("keeps earlier exchanges untouched", async () => {
    mockReplies("A1", "A2", "A2 mới");
    const { result } = renderHook(() => useChat("chat", "s1"));
    await act(async () => { await result.current.send("Q1"); });
    await act(async () => { await result.current.send("Q2"); });

    await act(async () => { await result.current.regenerate(null); });

    expect(turns(result.current.messages)).toEqual([
      ["user", "Q1"], ["assistant", "A1"], ["user", "Q2"], ["assistant", "A2 mới"],
    ]);
  });

  it("gives each turn its own bubble even within the same millisecond", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    mockReplies("A1", "A2");
    const { result } = renderHook(() => useChat("chat", "s1"));

    await act(async () => { await result.current.send("Q1"); });
    await act(async () => { await result.current.send("Q2"); });

    expect(new Set(result.current.messages.map(m => m.id)).size).toBe(4);
    expect(turns(result.current.messages)).toEqual([
      ["user", "Q1"], ["assistant", "A1"], ["user", "Q2"], ["assistant", "A2"],
    ]);
  });

  it("does nothing when there is no question yet", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useChat("chat", "s1"));

    await act(async () => { await result.current.regenerate(null); });
    await act(async () => { await result.current.editLast("x", null); });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });
});
