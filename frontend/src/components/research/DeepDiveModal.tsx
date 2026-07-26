import { useState, useRef } from "react";
import { Markdown } from "../../components/Markdown";
import { API } from "../../lib/api";
import { parseSSE, readErrorResponse } from "../../lib/sse";
import type { ModelSelection } from "../../types";

/** Superset of the shapes DeepDiveModal is opened with — a `Paper` (via
 *  PaperCard's onDeepDive) or a reference row (via ResearchResult's
 *  "Sources" list). Typed from what this component itself reads. */
export interface DiveSource {
  source?: string;
  title?: string;
  url?: string;
  pdf_url?: string;
  year?: number;
  citation_count?: number;
  authors?: string[];
  content?: string;
  snippet?: string;
}

interface DeepDiveModalProps {
  source: DiveSource;
  onClose: () => void;
  model: ModelSelection | null;
}

export function DeepDiveModal({ source, onClose, model }: DeepDiveModalProps) {
  const [question, setQuestion] = useState("");
  const [answer,   setAnswer]   = useState("");
  const [loading,  setLoading]  = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  const sourceColor = ({
    arxiv: "#7C9EFF", semantic_scholar: "#A8E6A3", huggingface: "#FFB085",
    openalex: "#E8A0FF", web: "#60D9FA", github: "#F9E04B", wiki: "#B8E0B8",
  } as Record<string, string>)[source?.source || ""] || "#888";

  const ask = async (q?: string) => {
    const text = q || question;
    if (!text.trim() || loading) return;
    setQuestion(text);
    setAnswer("");
    setLoading(true);
    abortRef.current = new AbortController();
    try {
      const res = await fetch(`${API}/api/research/deep-dive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          question: text,
          source_content: source.content || source.snippet || "",
          source_meta: { title: source.title, url: source.url, source: source.source },
          provider: model?.provider ?? null, model: model?.model ?? null,
        }),
      });
      if (!res.ok) { setAnswer(await readErrorResponse(res)); return; }
      for await (const { data } of parseSSE(res.body!)) {
        try {
          const ev = JSON.parse(data);
          if (ev.type === "token") {
            setAnswer(p => p + ev.content);
            answerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
          if (ev.type === "error") setAnswer(ev.message || "Unknown error");
        } catch {}
      }
    } catch(e) {
      if ((e as Error).name !== "AbortError") setAnswer("Connection lost.");
    } finally {
      setLoading(false);
    }
  };

  const PRESETS = [
    "Summarize the key findings of this source",
    "What methodology does this source use?",
    "What are the limitations mentioned?",
    "What data or numbers does this source cite?",
  ];

  return (
    <div className="dd-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dd-modal">
        <div className="dd-header">
          <div className="dd-header-left">
            <span className="dd-source-badge" style={{ color: sourceColor, borderColor: sourceColor + "44" }}>
              {source.source?.replace("_", " ")}
            </span>
            {source.year && <span className="dd-year">{source.year}</span>}
            {(source.citation_count ?? 0) > 0 && <span className="dd-cites">↑ {source.citation_count}</span>}
          </div>
          <button className="dd-close" onClick={() => { abortRef.current?.abort(); onClose(); }}>✕</button>
        </div>

        <div className="dd-title-wrap">
          <p className="dd-title">{source.title}</p>
          {source.authors?.length ? (
            <p className="dd-authors">{source.authors.slice(0, 4).join(", ")}{source.authors.length > 4 ? " et al." : ""}</p>
          ) : null}
          <div className="dd-links">
            {source.url && <a href={source.url} target="_blank" rel="noreferrer" className="dd-link">View source ↗</a>}
            {source.pdf_url && <a href={source.pdf_url} target="_blank" rel="noreferrer" className="dd-link">PDF ↗</a>}
          </div>
        </div>

        <div className="dd-content-section">
          <div className="dd-section-label">Content preview</div>
          <div className="dd-snippet">{source.content || source.snippet || "No content available."}</div>
        </div>

        <div className="dd-qa-section">
          <div className="dd-section-label">Ask about this source</div>

          <div className="dd-presets">
            {PRESETS.map((p, i) => (
              <button key={i} className="dd-preset-pill"
                style={{ borderColor: sourceColor + "44", color: sourceColor }}
                onClick={() => ask(p)}>{p}</button>
            ))}
          </div>

          <div className="dd-input-row">
            <input
              className="dd-input"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === "Enter" && ask()}
              placeholder="Ask anything about this source…"
              disabled={loading}
            />
            <button className="dd-ask-btn"
              style={{ background: loading ? "#2a2a3a" : sourceColor }}
              onClick={() => (loading ? abortRef.current?.abort() : ask())}
              disabled={!loading && !question.trim()}>
              {loading ? "■ Stop" : "Ask"}
            </button>
          </div>

          {answer && (
            <div className="dd-answer">
              <div className="dd-answer-label">◆ Answer</div>
              <div className="dd-answer-body"><Markdown text={answer} /></div>
              <div ref={answerRef} />
            </div>
          )}
          {loading && !answer && (
            <div className="dd-answer-loading">
              <span className="rp-dot" /><span className="rp-dot" /><span className="rp-dot" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
