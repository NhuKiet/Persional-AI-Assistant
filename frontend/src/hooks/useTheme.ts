import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "king-theme";

/** Đọc theme khởi tạo: localStorage được ưu tiên, Light là mặc định lần đầu.
 *  Khớp với script no-FOUC trong index.html. */
function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "light";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme(t => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
