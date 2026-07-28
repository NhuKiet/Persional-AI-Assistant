import { useCallback, useEffect, useState } from "react";
import { API } from "../lib/api";

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
}

/** Danh sách tin + nút làm mới thủ công. Không polling — chỉ fetch lại khi
 *  mount, đổi topic, hoặc người dùng bấm Làm mới. */
export function useNews(topic: NewsTopic | null): UseNewsResult {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = topic ? `?topic=${topic}` : "";
      const res = await fetch(`${API}/api/news${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: NewsListResponse = await res.json();
      setItems(data.items);
    } catch {
      setError("Không tải được tin tức — thử làm mới sau.");
    } finally {
      setLoading(false);
    }
  }, [topic]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshState("loading");
    try {
      const res = await fetch(`${API}/api/news/refresh`, { method: "POST" });
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

  return { items, loading, error, refresh, refreshState };
}
