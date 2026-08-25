import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { FallingLeaves } from "../components/news/FallingLeaves";
import { GlassControlPanel } from "../components/news/GlassControlPanel";
import {
  GLASS_PRESETS,
  toGlassVisualValues,
  type GlassMode,
  type GlassSettingName,
  type GlassSettings,
} from "../components/news/newsGlassSettings";
import { useNews, type NewsTopic } from "../hooks/useNews";
import communityVisual from "../assets/news/community.webp";
import modelReleaseVisual from "../assets/news/model-release.webp";
import researchVisual from "../assets/news/research.webp";
import roboticsVisual from "../assets/news/robotics.webp";

const TOPIC_TABS: { id: NewsTopic | null; label: string }[] = [
  { id: null, label: "Tất cả" },
  { id: "model_release", label: "Model mới" },
  { id: "research", label: "Nghiên cứu" },
  { id: "robotics", label: "Robotics" },
  { id: "community", label: "Cộng đồng" },
];

const TOPIC_BADGE: Record<NewsTopic, string> = {
  model_release: "Model mới",
  research: "Nghiên cứu",
  robotics: "Robotics",
  community: "Cộng đồng",
};

const NEWS_TOPIC_VISUALS: Record<NewsTopic, string> = {
  model_release: modelReleaseVisual,
  research: researchVisual,
  robotics: roboticsVisual,
  community: communityVisual,
};

function GlassLayers() {
  return (
    <>
      <span className="news-glass-effect" aria-hidden="true" />
      <span className="news-glass-tint" aria-hidden="true" />
      <span className="news-glass-shine" aria-hidden="true" />
    </>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  return `${Math.round(diffHour / 24)} ngày trước`;
}

export function NewsPage() {
  const [topic, setTopic] = useState<NewsTopic | null>(null);
  const [glassMode, setGlassMode] = useState<GlassMode>("tuned");
  const [glassPanelOpen, setGlassPanelOpen] = useState(false);
  const [glassSettings, setGlassSettings] = useState<GlassSettings>(() => ({
    ...GLASS_PRESETS.tuned,
  }));
  const glassPanelRef = useRef<HTMLDivElement>(null);
  const glassToggleRef = useRef<HTMLButtonElement>(null);
  const { items, loading, error, refresh, refreshState } = useNews(topic);
  const navigate = useNavigate();
  const visualValues = toGlassVisualValues(glassSettings);
  const glassStyle = {
    "--news-light-angle": `${glassSettings.lightAngle}deg`,
    "--news-light-alpha": visualValues.lightAlpha,
    "--news-blur": visualValues.blur,
    "--news-tint-alpha": visualValues.tintAlpha,
    "--news-depth-y": visualValues.depthY,
    "--news-depth-blur": visualValues.depthBlur,
    "--news-depth-alpha": visualValues.depthAlpha,
    "--news-dispersion-left": visualValues.dispersionLeft,
    "--news-dispersion-right": visualValues.dispersionRight,
    "--news-splay": visualValues.splay,
  } as CSSProperties;

  const selectGlassPreset = (mode: GlassMode) => {
    setGlassMode(mode);
    setGlassSettings({ ...GLASS_PRESETS[mode] });
  };

  const updateGlassSetting = (name: GlassSettingName, value: number) => {
    setGlassSettings((current) => ({ ...current, [name]: value }));
  };

  /** Popover: đóng khi bấm ra ngoài hoặc nhấn Esc, trả focus về nút cờ lê. */
  useEffect(() => {
    if (!glassPanelOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (glassPanelRef.current?.contains(target)) return;
      if (glassToggleRef.current?.contains(target)) return;
      setGlassPanelOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setGlassPanelOpen(false);
      glassToggleRef.current?.focus();
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [glassPanelOpen]);

  return (
    <main
      className={`news-page news-white-liquid-page ${glassMode === "tuned" ? "news-layered-tuned" : ""}`}
      style={glassStyle}
    >
      <svg className="news-liquid-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <filter id="news-glass-distortion" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="turbulence"
              baseFrequency="0.008"
              numOctaves="2"
              seed="5"
              result="news-glass-noise"
            />
            <feGaussianBlur
              in="news-glass-noise"
              stdDeviation="0.65"
              result="news-glass-noise-soft"
            />
            <feDisplacementMap
              id="news-glass-displacement"
              in="SourceGraphic"
              in2="news-glass-noise-soft"
              scale={glassSettings.refraction}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <filter id="news-liquid-refraction" x="-25%" y="-25%" width="150%" height="150%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.009 0.016"
              numOctaves="2"
              seed="9"
              result="news-noise"
            />
            <feGaussianBlur in="news-noise" stdDeviation="1.8" result="news-noise-soft" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="news-noise-soft"
              scale="7"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <filter id="news-liquid-refraction-soft" x="-25%" y="-25%" width="150%" height="150%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.014 0.024"
              numOctaves="2"
              seed="4"
              result="news-noise-tight"
            />
            <feGaussianBlur in="news-noise-tight" stdDeviation="1.4" result="news-noise-tight-soft" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="news-noise-tight-soft"
              scale="4"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <div className="news-liquid-ambient" aria-hidden="true">
        <span className="news-aurora news-aurora-cyan" />
        <span className="news-aurora news-aurora-violet" />
        <span className="news-aurora news-aurora-coral" />
        <span className="news-aurora news-aurora-gold" />
        <span className="news-aurora-prism" />
        <span className="news-caustic news-caustic-one" />
        <span className="news-caustic news-caustic-two" />
        <span className="news-caustic news-caustic-three" />
      </div>
      <FallingLeaves />
      <section className="news-controls" aria-label="Điều khiển bản tin">
        <div className="news-command-shell">
          <header className="news-header news-command-bar">
            <GlassLayers />
            <div className="news-bar-content">
              <button className="news-back" onClick={() => navigate("/")} aria-label="Về trang chủ">
                <GlassLayers />
                <svg
                  className="news-back-icon"
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 12H5.6M12 5.6 5.6 12l6.4 6.4"
                  />
                </svg>
              </button>
              <div className="news-title">News</div>
              <button
                className="news-refresh-btn"
                onClick={refresh}
                disabled={refreshState === "loading"}
                aria-busy={refreshState === "loading"}
              >
                <GlassLayers />
                <svg
                  className="news-refresh-icon"
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.4 11.4a8.4 8.4 0 1 1-2.5-5.9"
                  />
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.6 3.4v5.2h-5.2"
                  />
                </svg>
                <span className="news-refresh-label">Làm mới</span>
              </button>
              <button
                ref={glassToggleRef}
                className={`news-settings-btn ${glassPanelOpen ? "news-settings-btn-active" : ""}`}
                type="button"
                onClick={() => setGlassPanelOpen((open) => !open)}
                aria-label="Tinh chỉnh vật liệu kính"
                aria-expanded={glassPanelOpen}
                aria-controls="news-glass-panel"
              >
                <GlassLayers />
                <svg
                  className="news-settings-icon"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"
                  />
                </svg>
              </button>
              {refreshState === "loading" && (
                <span className="news-sr-only" role="status">Đang làm mới…</span>
              )}
            </div>
          </header>

          {glassPanelOpen && (
            <div className="news-mode-panel" id="news-glass-panel" ref={glassPanelRef}>
              <GlassLayers />
              <GlassControlPanel
                activePreset={glassMode}
                settings={glassSettings}
                onPresetChange={selectGlassPreset}
                onSettingChange={updateGlassSetting}
              />
            </div>
          )}
        </div>

        {refreshState === "cooldown" && (
          <p className="news-notice">Vừa mới cập nhật, thử lại sau.</p>
        )}

        <div className="news-tab-shell">
          <nav className="news-tabs news-tab-row" aria-label="Chủ đề tin tức">
            {TOPIC_TABS.map((tab) => (
              <button
                key={tab.label}
                className={`news-tab ${topic === tab.id ? "news-tab-active" : ""}`}
                onClick={() => setTopic(tab.id)}
                aria-pressed={topic === tab.id}
              >
                <GlassLayers />
                <span className="news-tab-label">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </section>

      <section className="news-feed" aria-label="Bản tin mới nhất">
        {loading && <p className="news-status">Đang tải…</p>}
        {error && <p className="news-status news-error">{error}</p>}
        {!loading && !error && (items ?? []).length === 0 && (
          <p className="news-status">Chưa có tin nào — nhấn Làm mới để cập nhật.</p>
        )}

        <ul className="news-list">
          {(items ?? []).map((item) => (
            <li key={item.url} className="news-card">
              <div className="news-card-visual" aria-hidden="true">
                <img src={NEWS_TOPIC_VISUALS[item.topic]} alt="" loading="lazy" decoding="async" />
              </div>
              <div className="news-card-content">
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="news-card-title">
                  {item.title_vi || item.title}
                </a>
                <p className="news-card-summary">{item.summary_vi || item.title}</p>
                <div className="news-card-meta">
                  <span className="news-badge">{TOPIC_BADGE[item.topic]}</span>
                  <span className="news-source">{item.source}</span>
                  <span className="news-time">{relativeTime(item.published_at ?? item.fetched_at)}</span>
                </div>
              </div>
              <span className="news-card-link-cue" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 6l6 6-6 6"
                  />
                </svg>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
