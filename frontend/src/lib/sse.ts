/** Shared Server-Sent-Events transport for every streaming feature (Chat,
 *  Research, Coding, PDF, Deep Dive). A network `ReadableStream` chunk can
 *  split anywhere — mid multi-byte UTF-8 character, mid line, mid blank-line
 *  event terminator — so parsing must buffer across chunks rather than
 *  decode+split each chunk independently. */

export interface SSEEvent {
  event: string;
  data: string;
}

/** Parses a raw fetch() response body stream into SSE events, buffering
 *  partial lines/characters across chunk boundaries. Blank lines terminate
 *  an event; multiple `data:` lines are joined with "\n" per the SSE spec;
 *  lines starting with ":" are comments and ignored; an event with no
 *  `event:` field defaults to "message". An event that never receives its
 *  terminating blank line (e.g. the stream ends mid-event) is discarded,
 *  never parsed as if it were complete. */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventType = "message";
  let dataLines: string[] = [];

  function consumeLine(line: string): SSEEvent | null {
    if (line.endsWith("\r")) line = line.slice(0, -1);

    if (line === "") {
      if (dataLines.length === 0) { eventType = "message"; return null; }
      const ev: SSEEvent = { event: eventType, data: dataLines.join("\n") };
      eventType = "message";
      dataLines = [];
      return ev;
    }
    if (line.startsWith(":")) return null; // comment

    const colonIdx = line.indexOf(":");
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") eventType = value;
    else if (field === "data") dataLines.push(value);
    return null;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx: number;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        const ev = consumeLine(line);
        if (ev) yield ev;
      }
    }
    // Flush any pending multi-byte sequence held by the decoder, then drain
    // whatever complete lines that produces. A final incomplete line (no
    // trailing "\n") or an event missing its terminating blank line is
    // intentionally left unparsed and discarded.
    buffer += decoder.decode();
    let nlIdx: number;
    while ((nlIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nlIdx);
      buffer = buffer.slice(nlIdx + 1);
      const ev = consumeLine(line);
      if (ev) yield ev;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Turns a non-OK fetch() Response into a human-readable error string —
 *  prefers a JSON `detail`/`message`/`error` field (FastAPI's error shape),
 *  falls back to the raw text body, then to a generic status message. */
export async function readErrorResponse(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const msg = data?.detail ?? data?.message ?? data?.error;
      if (typeof msg === "string" && msg) return msg;
    } catch {
      // not JSON — fall through to raw text
    }
    return text;
  }
  return `Backend error ${response.status}`;
}
