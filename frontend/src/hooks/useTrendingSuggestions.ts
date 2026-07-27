import { useEffect, useState } from "react";
import { API } from "../lib/api";

/** Tiêu đề paper nổi bật hôm nay (HuggingFace daily papers), lấy 1 lần mỗi
 *  khi trang Research mount — trộn vào danh sách gợi ý tĩnh để vừa gợi ý chủ
 *  đề vừa cho biết "gần đây có nghiên cứu gì mới". Lỗi mạng/API thì âm thầm
 *  giữ [] — trang gọi hook này tự fallback về gợi ý tĩnh, không cần biết lý do. */
export function useTrendingSuggestions(): string[] {
  const [titles, setTitles] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/research/trending`)
      .then(r => (r.ok ? r.json() : { suggestions: [] }))
      .then(data => {
        if (!cancelled && Array.isArray(data.suggestions)) setTitles(data.suggestions);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return titles;
}
