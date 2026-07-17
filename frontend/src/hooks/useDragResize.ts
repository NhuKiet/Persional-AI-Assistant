import { useState, useRef, useCallback } from "react";

export interface UseDragResizeOptions {
  defaultPct?: number;
  minPct?: number;
  maxPct?: number;
  storageKey?: string;
}

export interface UseDragResizeResult {
  pct: number;
  containerRef: React.RefObject<HTMLDivElement>;
  onMouseDown: (e: React.MouseEvent | React.TouchEvent) => void;
}

export function useDragResize({
  defaultPct = 38,
  minPct = 20,
  maxPct = 65,
  storageKey = "coding_split_pct",
}: UseDragResizeOptions = {}): UseDragResizeResult {
  const saved = () => {
    try { const v = parseFloat(localStorage.getItem(storageKey) || ""); return isNaN(v) ? defaultPct : v; }
    catch { return defaultPct; }
  };
  const [pct, setPct] = useState<number>(saved);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: MouseEvent | TouchEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientX = "clientX" in ev ? ev.clientX : ev.touches?.[0]?.clientX;
      if (clientX === undefined) return;
      const x = clientX - rect.left;
      const newPct = Math.min(maxPct, Math.max(minPct, (x / rect.width) * 100));
      setPct(newPct);
    };

    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
      setPct(p => { try { localStorage.setItem(storageKey, String(p)); } catch {} return p; });
    };

    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", up);
  }, [minPct, maxPct, storageKey]);

  return { pct, containerRef, onMouseDown };
}
