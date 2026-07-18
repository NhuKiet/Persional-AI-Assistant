import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  lang?: string;
  onResult: (text: string) => void;
}

/** Bọc Web Speech API. Client-only, không backend. Ẩn khi không hỗ trợ
 *  (Firefox, Safari cũ) — caller kiểm `supported` để không render nút chết. */
export function useSpeechRecognition({ lang = "vi-VN", onResult }: Options) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const supported = Boolean(SR);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    if (!supported) return;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text) onResultRef.current(text);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    return () => {
      try { rec.stop(); } catch { /* already stopped */ }
      setListening(false);
      recRef.current = null;
    };
  }, [supported, lang, SR]);

  const start = useCallback(() => {
    if (!recRef.current || listening) return;
    try { recRef.current.start(); setListening(true); } catch { /* start twice */ }
  }, [listening]);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch { /* noop */ }
    setListening(false);
  }, []);

  return { supported, listening, start, stop };
}
