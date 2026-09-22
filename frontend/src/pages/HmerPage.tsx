import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { LatexPreview } from "../components/hmer/LatexPreview";
import { useChatHistory } from "../hooks/useChatHistory";
import {
  describeStatus,
  fetchHmerStatus,
  hmerImageUrl,
  recognizeImage,
  type HmerResult,
  type HmerStatus,
} from "../lib/hmerApi";
import "../styles/hmer.css";

const ACCEPT = "image/png,image/jpeg,image/bmp";

export function HmerPage() {
  const accentColor = "var(--accent-hmer)";
  const { sessions, activeId, setActiveId, removeSession, clearAll } =
    useChatHistory("hmer");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [status, setStatus] = useState<HmerStatus | null>(null);
  const [result, setResult] = useState<HmerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Asked once on mount so the page can say "checkpoint missing" before the
  // user picks a file, instead of letting them find out by uploading.
  useEffect(() => {
    let cancelled = false;
    void fetchHmerStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // A backend that is simply not running is not worth an alarm here —
        // the upload attempt will report it clearly enough.
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError("");
    setResult(null);
    setCopied(false);
    try {
      setResult(await recognizeImage(file));
      // Recognition succeeding proves the model loaded, so refresh the banner
      // rather than leaving a stale "not loaded" line under a live result.
      void fetchHmerStatus().then(setStatus).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const copyLatex = useCallback(async () => {
    if (!result?.latex) return;
    try {
      await navigator.clipboard.writeText(result.latex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is permission-gated and blocked outright in some contexts.
      // The LaTeX is already on screen and selectable, so a failed copy is
      // not worth an error state.
    }
  }, [result]);

  const statusNote = describeStatus(status);

  return (
    <AppShell
      open={sidebarOpen}
      onToggle={() => setSidebarOpen((v) => !v)}
      sessions={sessions}
      activeId={activeId}
      onSelect={(session) => setActiveId(session.id)}
      onDelete={removeSession}
      onClearAll={clearAll}
      onNewChat={() => {
        setResult(null);
        setError("");
        setActiveId(null);
      }}
      toolLabel="Công thức viết tay"
      toolColor={accentColor}
    >
      <div className="hmer-page">
        <header className="hmer-head">
          <h1 className="hmer-title">Công thức viết tay</h1>
          <p className="hmer-sub">
            Tải lên ảnh <strong>một biểu thức</strong> toán viết tay, nhận lại LaTeX.
            Ảnh chụp cả trang nhiều dòng sẽ cho kết quả sai — hãy cắt từng biểu thức.
          </p>
        </header>

        {statusNote && (
          <p className="hmer-status" role="status">
            {statusNote}
          </p>
        )}

        <div
          className={`hmer-drop${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Chọn ảnh công thức"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              // Reset so picking the same file twice still fires onChange.
              e.target.value = "";
            }}
          />
          {busy ? (
            <span className="hmer-busy">
              <span className="hmer-spinner" aria-hidden="true" />
              Đang nhận dạng…
            </span>
          ) : (
            <>
              <span className="hmer-drop-main">Kéo thả ảnh công thức vào đây</span>
              <span className="hmer-drop-sub">hoặc bấm để chọn — PNG, JPG, BMP</span>
            </>
          )}
        </div>

        {error && (
          <p className="hmer-error" role="alert">
            {error}
          </p>
        )}

        {result && (
          <section className="hmer-result">
            <div className="hmer-panel">
              <h2 className="hmer-panel-title">Ảnh đã nhận</h2>
              <img
                className="hmer-thumb"
                src={hmerImageUrl(result.filename)}
                alt="Ảnh công thức đã tải lên"
              />
            </div>

            <div className="hmer-panel">
              <h2 className="hmer-panel-title">Công thức</h2>
              <LatexPreview latex={result.latex} />

              {result.latex && (
                <>
                  <code className="hmer-code">{result.latex}</code>
                  <button className="hmer-copy" onClick={copyLatex}>
                    {copied ? "Đã chép" : "Chép LaTeX"}
                  </button>
                </>
              )}

              <dl className="hmer-meta">
                <div>
                  <dt>Thời gian</dt>
                  <dd>{result.elapsed_ms} ms</dd>
                </div>
                <div>
                  <dt>Thiết bị</dt>
                  <dd>{result.device}</dd>
                </div>
                <div>
                  {/* Beam-search log-probability. Not calibrated, so it ranks
                      one result against another rather than meaning anything
                      on its own — labelled "điểm" and not a percentage. */}
                  <dt>Điểm</dt>
                  <dd>{result.score.toFixed(3)}</dd>
                </div>
              </dl>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

export default HmerPage;
