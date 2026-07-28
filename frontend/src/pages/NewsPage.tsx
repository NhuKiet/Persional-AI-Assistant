import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNews, type NewsTopic } from "../hooks/useNews";
import communityVisual from "../assets/news/community.png";
import modelReleaseVisual from "../assets/news/model-release.png";
import researchVisual from "../assets/news/research.png";
import roboticsVisual from "../assets/news/robotics.png";

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
  const { items, loading, error, refresh, refreshState } = useNews(topic);
  const navigate = useNavigate();

  return (
    <main className="news-page news-white-liquid-page">
      <div className="news-liquid-ambient" aria-hidden="true">
        <span className="news-liquid-ribbon" />
        <span className="news-liquid-orb news-liquid-orb-one" />
        <span className="news-liquid-orb news-liquid-orb-two" />
      </div>
      <header className="news-header">
        <button className="news-back" onClick={() => navigate("/")} aria-label="Về trang chủ">←</button>
        <h1>Tin tức AI &amp; Robotics</h1>
        <button
          className="news-refresh-btn"
          onClick={refresh}
          disabled={refreshState === "loading"}
        >
          {refreshState === "loading" ? "Đang làm mới…" : "Làm mới"}
        </button>
      </header>

      {refreshState === "cooldown" && (
        <p className="news-notice">Vừa mới cập nhật, thử lại sau.</p>
      )}

      <nav className="news-tabs">
        {TOPIC_TABS.map(t => (
          <button
            key={t.label}
            className={`news-tab ${topic === t.id ? "news-tab-active" : ""}`}
            onClick={() => setTopic(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {loading && <p className="news-status">Đang tải…</p>}
      {error && <p className="news-status news-error">{error}</p>}
      {!loading && !error && (items ?? []).length === 0 && (
        <p className="news-status">Chưa có tin nào — nhấn Làm mới để cập nhật.</p>
      )}

      <ul className="news-list">
        {(items ?? []).map(item => (
          <li key={item.url} className="news-card">
            <div className="news-card-visual" aria-hidden="true">
              <img src={NEWS_TOPIC_VISUALS[item.topic]} alt="" />
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
            <span className="news-card-link-cue" aria-hidden="true">â†’</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
