import { useCallback, useEffect, useRef, useState } from "react";

export type PdfLayoutMode = "desktop" | "laptop" | "narrow";

const OUTLINE_STORAGE_KEY = "pdf-outline-open";
const ASSISTANT_STORAGE_KEY = "pdf-assistant-open";

function readLayoutMode(): PdfLayoutMode {
  if (window.innerWidth < 900) return "narrow";
  if (window.innerWidth < 1280) return "laptop";
  return "desktop";
}

export function usePdfLayoutMode(): PdfLayoutMode {
  const [mode, setMode] = useState<PdfLayoutMode>(readLayoutMode);

  useEffect(() => {
    const onResize = () => setMode(readLayoutMode());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return mode;
}

function stored(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}

interface PdfPanelState {
  outlineOpen: boolean;
  assistantOpen: boolean;
}

export function usePdfLayout(mode: PdfLayoutMode) {
  const [panels, setPanels] = useState<PdfPanelState>(() => ({
    outlineOpen: mode === "desktop" && stored(OUTLINE_STORAGE_KEY, true),
    assistantOpen: mode !== "narrow" && stored(ASSISTANT_STORAGE_KEY, true),
  }));
  const panelsRef = useRef(panels);

  const updatePanels = useCallback((next: PdfPanelState) => {
    panelsRef.current = next;
    setPanels(next);
  }, []);

  useEffect(() => {
    if (mode !== "narrow") return;
    const current = panelsRef.current;
    if (current.outlineOpen && current.assistantOpen) {
      updatePanels({ ...current, outlineOpen: false });
    }
  }, [mode, updatePanels]);

  const toggleOutline = useCallback(() => {
    const current = panelsRef.current;
    const outlineOpen = !current.outlineOpen;
    updatePanels({
      outlineOpen,
      assistantOpen: mode === "narrow" && outlineOpen ? false : current.assistantOpen,
    });
    localStorage.setItem(OUTLINE_STORAGE_KEY, String(outlineOpen));
  }, [mode, updatePanels]);

  const toggleAssistant = useCallback(() => {
    const current = panelsRef.current;
    const assistantOpen = !current.assistantOpen;
    updatePanels({
      outlineOpen: mode === "narrow" && assistantOpen ? false : current.outlineOpen,
      assistantOpen,
    });
    localStorage.setItem(ASSISTANT_STORAGE_KEY, String(assistantOpen));
  }, [mode, updatePanels]);

  const closeOverlays = useCallback(() => {
    updatePanels({ outlineOpen: false, assistantOpen: false });
  }, [updatePanels]);

  return {
    outlineOpen: panels.outlineOpen,
    assistantOpen: panels.assistantOpen,
    toggleOutline,
    toggleAssistant,
    closeOverlays,
  };
}
