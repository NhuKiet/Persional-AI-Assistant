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

// ── Loading more ────────────────────────────────────────────────────────────

const item = (n: number) => ({ ...SAMPLE_ITEM, url: `https://example.com/${n}`, title_vi: `Tin ${n}` });
const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => item(from + i));

/** Serves pages by offset from `pages`; records every requested URL. */
function pagedFetch(pages: Record<number, { items: unknown[]; has_more: boolean }>) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(String(url));
    const offset = Number(new URL(String(url)).searchParams.get("offset") ?? 0);
    return jsonResponse({ ...pages[offset], limit: 20, offset });
  }));
  return urls;
}

describe("useNews — loading more", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("knows whether older items exist and appends the next page", async () => {
    const urls = pagedFetch({ 0: { items: page(0, 20), has_more: true }, 20: { items: page(20, 5), has_more: false } });
    const { result } = renderHook(() => useNews("research"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMore).toBe(true);

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.items).toHaveLength(25);
    expect(result.current.items[24].title_vi).toBe("Tin 24");
    expect(result.current.hasMore).toBe(false);
    expect(urls[1]).toContain("topic=research");
    expect(urls[1]).toContain("offset=20");
  });

  it("skips items already shown when new ones shifted the pages", async () => {
    // A refresh between the two requests pushed item 19 onto the next page.
    pagedFetch({ 0: { items: page(0, 20), has_more: true }, 20: { items: page(19, 3), has_more: false } });
    const { result } = renderHook(() => useNews(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.loadMore(); });

    const urls = result.current.items.map(i => i.url);
    expect(urls).toHaveLength(22);
    expect(new Set(urls).size).toBe(22);
  });

  it("drops a page that arrives after the topic changed", async () => {
    let releaseOld!: () => void;
    const held = new Promise<void>(r => { releaseOld = r; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = new URL(String(url));
      if (u.searchParams.get("offset") === "20") {
        await held;
        return jsonResponse({ items: page(100, 3), has_more: false, limit: 20, offset: 20 });
      }
      const topic = u.searchParams.get("topic");
      return jsonResponse({ items: topic ? [item(500)] : page(0, 20), has_more: !topic, limit: 20, offset: 0 });
    }));
    const { result, rerender } = renderHook(({ topic }) => useNews(topic), { initialProps: { topic: null as null | "robotics" } });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let pending!: Promise<void>;
    act(() => { pending = result.current.loadMore(); });
    rerender({ topic: "robotics" });
    await waitFor(() => expect(result.current.items.map(i => i.url)).toEqual([item(500).url]));
    releaseOld();
    await act(async () => { await pending; });

    expect(result.current.items.map(i => i.url)).toEqual([item(500).url]);
  });

  it("keeps the list when loading more fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const offset = new URL(String(url)).searchParams.get("offset");
      return offset === "20" ? jsonResponse({}, 503) : jsonResponse({ items: page(0, 20), has_more: true, limit: 20, offset: 0 });
    }));
    const { result } = renderHook(() => useNews(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.loadMore(); });

    expect(result.current.items).toHaveLength(20);
    expect(result.current.loadMoreError).toMatch(/Không tải thêm được/);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
