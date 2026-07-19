import { useCallback, useEffect, useRef, useState } from "react";

export type PdfLayoutMode = "desktop" | "laptop" | "narrow";

const OUTLINE_STORAGE_KEY = "pdf-outline-open";
const ASSISTANT_STORAGE_KEY = "pdf-assistant-open";

function readLayoutMode(): PdfLayoutMode {
  if (typeof window === "undefined") return "desktop";
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
  if (typeof localStorage === "undefined") return fallback;
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function persist(key: string, value: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage may be unavailable in privacy-restricted browsing contexts.
  }
}

interface TransientPanelState {
  mode: PdfLayoutMode;
  outlineOpen: boolean;
  assistantOpen: boolean;
}

export function usePdfLayout(mode: PdfLayoutMode) {
  const [outlinePreference, setOutlinePreference] = useState(
    () => stored(OUTLINE_STORAGE_KEY, true),
  );
  const [assistantPreference, setAssistantPreference] = useState(
    () => stored(ASSISTANT_STORAGE_KEY, true),
  );
  const outlinePreferenceRef = useRef(outlinePreference);
  const assistantPreferenceRef = useRef(assistantPreference);
  const [transient, setTransient] = useState<TransientPanelState>(() => ({
    mode,
    outlineOpen: false,
    assistantOpen: false,
  }));

  const updateTransient = useCallback((next: TransientPanelState) => {
    setTransient(next);
  }, []);

  useEffect(() => {
    setTransient((current) => current.mode === mode ? current : {
      mode,
      outlineOpen: false,
      assistantOpen: false,
    });
  }, [mode]);

  const transientMatchesMode = transient.mode === mode;
  const outlineOpen = mode === "desktop"
    ? outlinePreference
    : transientMatchesMode && transient.outlineOpen;
  const assistantOpen = mode === "narrow"
    ? transientMatchesMode && transient.assistantOpen
    : assistantPreference;

  const toggleOutline = useCallback(() => {
    if (mode === "desktop") {
      const next = !outlinePreferenceRef.current;
      outlinePreferenceRef.current = next;
      setOutlinePreference(next);
      persist(OUTLINE_STORAGE_KEY, next);
      return;
    }

    const next = !outlineOpen;
    updateTransient({
      mode,
      outlineOpen: next,
      assistantOpen: mode === "narrow" && next ? false : assistantOpen,
    });
  }, [assistantOpen, mode, outlineOpen, updateTransient]);

  const toggleAssistant = useCallback(() => {
    if (mode !== "narrow") {
      const next = !assistantPreferenceRef.current;
      assistantPreferenceRef.current = next;
      setAssistantPreference(next);
      persist(ASSISTANT_STORAGE_KEY, next);
      return;
    }

    const next = !assistantOpen;
    updateTransient({
      mode,
      outlineOpen: next ? false : outlineOpen,
      assistantOpen: next,
    });
  }, [assistantOpen, mode, outlineOpen, updateTransient]);

  const closeOverlays = useCallback(() => {
    if (mode === "desktop") return;
    updateTransient({ mode, outlineOpen: false, assistantOpen: false });
  }, [mode, updateTransient]);

  return {
    outlineOpen,
    assistantOpen,
    toggleOutline,
    toggleAssistant,
    closeOverlays,
  };
}
