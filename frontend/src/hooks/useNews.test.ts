import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNews } from "./useNews";

const SAMPLE_ITEM = {
  url: "https://example.com/a",
  title: "Title",
  title_vi: "Tiêu đề",
  summary_vi: "Tóm tắt",
  source: "OpenAI Blog",
  topic: "model_release",
  published_at: "2026-07-27T10:00:00Z",
  fetched_at: "2026-07-28T10:00:00Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useNews", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads items on mount", async () => {
    const { result } = renderHook(() => useNews(null));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].title_vi).toBe("Tiêu đề");
  });

  it("requests the topic query param when a topic is set", async () => {
    renderHook(() => useNews("robotics"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const calledUrl = String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain("topic=robotics");
  });

  it("sets an error message on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 503)));
    const { result } = renderHook(() => useNews(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it("refresh() re-fetches the list on success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ new_count: 2 }))
      .mockResolvedValueOnce(jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNews(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.refreshState).toBe("idle");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refresh() sets cooldown state on 429 without re-fetching the list", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ detail: "cooldown" }, 429));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNews(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.refreshState).toBe("cooldown");
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial load + refresh POST, no extra list re-fetch
  });
});
