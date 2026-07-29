import { useState } from "react";
import { useNavigate } from "react-router-dom";
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

type GlassMode = "original" | "tuned";

const GLASS_MODES = {
  original: { tint: "50%", blur: "3px", scale: 77 },
  tuned: { tint: "17%", blur: "1.25px", scale: 46 },
} as const;

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
  const { items, loading, error, refresh, refreshState } = useNews(topic);
  const navigate = useNavigate();
  const mode = GLASS_MODES[glassMode];

  return (
    <main
      className={`news-page news-white-liquid-page ${glassMode === "tuned" ? "news-layered-tuned" : ""}`}
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
              scale={mode.scale}
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
      <div className="news-scene-word" aria-hidden="true">AI / ROBOTICS</div>

      <section className="news-intro">
        <div>
          <p className="news-eyebrow">Layered glass digest</p>
          <h1>Bốn lớp.<br />Một mặt kính.</h1>
        </div>
        <p className="news-intro-note">
          Tin AI được đặt trên vật liệu kính gồm khúc xạ, màng màu,
          viền sáng và nội dung sắc nét.
        </p>
      </section>

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
              <div className="news-title">Tin tức AI &amp; Robotics</div>
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
              {refreshState === "loading" && (
                <span className="news-sr-only" role="status">Đang làm mới…</span>
              )}
            </div>
          </header>
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

      <section className="news-glass-comparison" aria-label="So sánh chế độ kính">
        <div className="news-lens">
          <GlassLayers />
          <div className="news-lens-copy">
            <strong>Nhìn xuyên qua khối kính</strong>
            <span>Nền chuyển động làm lộ rõ blur và displacement.</span>
          </div>
        </div>

        <aside className="news-mode-panel">
          <GlassLayers />
          <div className="news-mode-content">
            <span className="news-mode-label">So sánh trực tiếp</span>
            <div className="news-mode-buttons">
              {(["original", "tuned"] as GlassMode[]).map((name) => (
                <button
                  key={name}
                  className="news-mode-button"
                  type="button"
                  onClick={() => setGlassMode(name)}
                  aria-pressed={glassMode === name}
                >
                  {name === "original" ? "Nguyên bản" : "Tinh chỉnh"}
                </button>
              ))}
            </div>
            <dl className="news-mode-readout">
              <div><dt>Tint</dt><dd>{mode.tint}</dd></div>
              <div><dt>Blur</dt><dd>{mode.blur}</dd></div>
              <div><dt>Displacement</dt><dd>{mode.scale}</dd></div>
            </dl>
          </div>
        </aside>
      </section>

      <section className="news-feed" aria-labelledby="news-feed-title">
        <div className="news-feed-heading">
          <p className="news-eyebrow">Live intelligence</p>
          <h2 id="news-feed-title">Bản tin mới nhất</h2>
        </div>

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
