import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { PdfLayoutMode } from "./usePdfLayout";

interface PdfWorkspaceProps {
  mode: PdfLayoutMode;
  outlineOpen: boolean;
  assistantOpen: boolean;
  toolbar: ReactNode;
  outline: ReactNode;
  viewer: ReactNode;
  assistant: ReactNode;
  onCloseOverlays: () => void;
}

const FOCUSABLE_SELECTOR = [
  "button",
  "[href]",
  "input",
  "textarea",
  "select",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export default function PdfWorkspace({
  mode,
  outlineOpen,
  assistantOpen,
  toolbar,
  outline,
  viewer,
  assistant,
  onCloseOverlays,
}: PdfWorkspaceProps) {
  const activeOverlayRef = useRef<HTMLElement>(null);
  const lastOverlayPanelRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseOverlaysRef = useRef(onCloseOverlays);
  onCloseOverlaysRef.current = onCloseOverlays;
  const activeOverlay = mode === "narrow"
    ? outlineOpen
      ? "outline"
      : assistantOpen
        ? "assistant"
        : null
    : null;
  const latestOverlayRef = useRef(activeOverlay);
  latestOverlayRef.current = activeOverlay;

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current;
    openerRef.current = null;
    lastOverlayPanelRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, []);

  useEffect(() => () => restoreFocus(), [restoreFocus]);

  useEffect(() => {
    if (!activeOverlay) return;

    const panel = activeOverlayRef.current;
    if (!panel) return;
    const candidate = document.activeElement as HTMLElement | null;
    const lastPanel = lastOverlayPanelRef.current;
    if (
      candidate
      && candidate !== document.body
      && candidate.isConnected
      && !lastPanel?.contains(candidate)
    ) {
      openerRef.current = candidate;
    }
    lastOverlayPanelRef.current = panel;

    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");

    const initialItems = focusable();
    (initialItems[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseOverlaysRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !panel.contains(focused))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || !panel.contains(focused))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (latestOverlayRef.current === null) restoreFocus();
    };
  }, [activeOverlay, restoreFocus]);

  const showBackdrop = mode === "laptop"
    ? outlineOpen
    : mode === "narrow" && (outlineOpen || assistantOpen);

  return (
    <section className={`pdf-workspace pdf-workspace-${mode}`}>
      <div className="pdf-workspace-toolbar">{toolbar}</div>
      <div className="pdf-workspace-body">
        <div className="pdf-outline-slot">
          {outlineOpen ? (
            <nav
              aria-label="Mục lục tài liệu"
              className="pdf-outline-panel"
              ref={activeOverlay === "outline" ? activeOverlayRef : undefined}
              tabIndex={activeOverlay === "outline" ? -1 : undefined}
            >
              {outline}
            </nav>
          ) : null}
        </div>
        <main className="pdf-viewer-panel" aria-label="Trình đọc PDF">{viewer}</main>
        <div className="pdf-assistant-slot">
          {assistantOpen ? (
            <aside
              aria-label="Trợ lý tài liệu"
              className="pdf-assistant-panel"
              ref={activeOverlay === "assistant" ? activeOverlayRef : undefined}
              tabIndex={activeOverlay === "assistant" ? -1 : undefined}
            >
              {assistant}
            </aside>
          ) : null}
        </div>
        {showBackdrop ? (
          <button
            aria-label="Đóng bảng đang mở"
            className="pdf-overlay-backdrop"
            onClick={onCloseOverlays}
            type="button"
          />
        ) : null}
      </div>
    </section>
  );
}
