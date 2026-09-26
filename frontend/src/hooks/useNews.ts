import { useCallback, useEffect, useRef, useState } from "react";
import { API, apiFetch } from "../lib/api";

export type NewsTopic = "model_release" | "research" | "robotics" | "community";

export interface NewsItem {
  url: string;
  title: string;
  title_vi: string;
  summary_vi: string;
  source: string;
  topic: NewsTopic;
  published_at: string | null;
  fetched_at: string;
}

interface NewsListResponse {
  items: NewsItem[];
  limit: number;
  offset: number;
  has_more: boolean;
}

type RefreshState = "idle" | "loading" | "cooldown";

interface UseNewsResult {
  items: NewsItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshState: RefreshState;
  /** Older items exist beyond what is listed. */
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string | null;
  loadMore: () => Promise<void>;
}

const PAGE_SIZE = 20;

function listUrl(topic: NewsTopic | null, offset: number): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (topic) params.set("topic", topic);
  return `${API}/api/news?${params}`;
}

/** Danh sách tin + nút làm mới thủ công + tải thêm tin cũ. Không polling —
 *  chỉ fetch lại khi mount, đổi topic, hoặc người dùng bấm Làm mới. */
export function useNews(topic: NewsTopic | null): UseNewsResult {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Bumped on every fresh load (topic change, refresh). A "load more" answer
  // from an older generation belongs to a list that is no longer shown.
  const generation = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    setLoadMoreError(null);
    try {
      const res = await apiFetch(listUrl(topic, 0));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: NewsListResponse = await res.json();
      if (gen !== generation.current) return;
      setItems(data.items ?? []);
      setHasMore(Boolean(data.has_more));
    } catch {
      if (gen === generation.current) setError("Không tải được tin tức — thử làm mới sau.");
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [topic]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await apiFetch(listUrl(topic, itemsRef.current.length));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: NewsListResponse = await res.json();
      if (gen !== generation.current) return;
      // Items fetched since the first page push older ones down a slot, so
      // the next page can repeat what is already listed.
      setItems(prev => {
        const seen = new Set(prev.map(i => i.url));
        return [...prev, ...(data.items ?? []).filter(i => !seen.has(i.url))];
      });
      setHasMore(Boolean(data.has_more));
    } catch {
      if (gen === generation.current) setLoadMoreError("Không tải thêm được — thử lại sau.");
    } finally {
      if (gen === generation.current) setLoadingMore(false);
    }
  }, [topic, loadingMore]);

  const refresh = useCallback(async () => {
    setRefreshState("loading");
    try {
      const res = await apiFetch(`${API}/api/news/refresh`, { method: "POST" });
      if (res.status === 429) {
        setRefreshState("cooldown");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      setRefreshState("idle");
    } catch {
      setError("Làm mới thất bại — thử lại sau.");
      setRefreshState("idle");
    }
  }, [load]);

  return { items, loading, error, refresh, refreshState, hasMore, loadingMore, loadMoreError, loadMore };
}
