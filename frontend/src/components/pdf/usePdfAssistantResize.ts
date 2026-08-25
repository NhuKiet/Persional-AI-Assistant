import { useCallback, useRef, useState } from "react";

/** Drag-resize for the PDF assistant (chat) panel — mirrors useDragResize's
 * approach but anchors to the CONTAINER'S RIGHT edge instead of the left,
 * since the assistant panel sits on the right side of the workspace and its
 * width is what the drag handle controls (not a left/right split percentage). */

const STORAGE_KEY = "pdf_assistant_width";

export interface UsePdfAssistantResizeResult {
  width: number;
  containerRef: React.RefObject<HTMLDivElement>;
  onMouseDown: (e: React.MouseEvent | React.TouchEvent) => void;
}

export function usePdfAssistantResize(
  defaultWidth = 360,
  minWidth = 280,
  maxWidth = 560,
): UsePdfAssistantResizeResult {
  const saved = () => {
    try {
      const v = parseFloat(localStorage.getItem(STORAGE_KEY) || "");
      return isNaN(v) ? defaultWidth : v;
    } catch {
      return defaultWidth;
    }
  };
  const [width, setWidth] = useState<number>(saved);
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
      const newWidth = rect.right - clientX;
      setWidth(Math.min(maxWidth, Math.max(minWidth, newWidth)));
    };

    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
      setWidth((w) => {
        try { localStorage.setItem(STORAGE_KEY, String(w)); } catch { /* ignore */ }
        return w;
      });
    };

    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", up);
  }, [minWidth, maxWidth]);

  return { width, containerRef, onMouseDown };
}
