import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import mainlogo from "../assets/mainlogo.png";
import { MoonPhase } from "../components/MoonPhase";
import { PortfolioCarousel } from "../components/PortfolioCarousel";
import { CORE_FEATURES, type Lang } from "../config/portfolio";
import { useTheme } from "../hooks/useTheme";
import { createCompass, readCalendar } from "../three/compass";
import type { CompassHandle, CompassReadout } from "../three/compass";

/** Trang chủ — bố cục dashboard kính (glassmorphism), cuộn dọc:
 *
 *    ┌──────────── portfolio (carousel) ────────────┐ ┌ Trợ lý cá nhân của Kiệt ┐
 *    │                                               │ └─────────────────────────┘
 *    │                                               │ ┌ Lịch thiên văn ──────────┐
 *    └───────────────────────────────────────────────┘ └─────────────────────────┘
 *    ┌──────────────── La bàn thiên văn (3D) + chú giải sáu vành ────────────────┐
 *
 *  La bàn: sáu vành đồng tâm (chòm sao, 28 tú, 24 tiết khí, thước độ, 12 tháng,
 *  lõi Bắc Đẩu) vẽ bằng nét sáng, tự quay chậm ngược chiều nhau; kéo một vành
 *  để xoay riêng nó, kéo ngoài đĩa để xoay cả cảnh, Ctrl/⌘ + cuộn để phóng.
 *
 *  Cảnh cũ "Capability Reactor" (three/atomReactor.ts) vẫn còn trong repo và
 *  cùng hình dạng handle — đổi lại chỉ là đổi hai dòng import này.
 *
 *  ATOM_BG là clear color của WebGL, PHẢI trùng --atom-bg trong landing.css —
 *  canvas nằm trong một khung nền --atom-bg, lệch màu là lộ đường ranh. */
const ATOM_BG = { dark: 0x2a2629, light: 0x2a2629 };

/** Tính lại thẻ lịch bao lâu một lần — cùng nhịp với lớp lịch trên mặt đĩa
 *  (CALENDAR_REFRESH_MS trong three/compass/index.ts). */
const CALENDAR_REFRESH_MS = 10 * 60 * 1000;
/** Nửa tháng giao hội: tuổi trăng dưới mức này là trăng đang tròn dần. */
const HALF_SYNODIC_DAYS = 29.530588853 / 2;

/** Chú giải sáu vành, từ ngoài vào trong — khớp LAYERS trong
 *  three/compass/config.js. Kim nào màu gì: xem applyTheme() trong index.ts. */
const COMPASS_RINGS = [
  { name: "Chòm sao", desc: "Hình 28 chòm sao dọc hoàng đạo" },
  { name: "28 tú", desc: "Nhị thập bát tú và thiên can · kim xanh là Mặt Trăng" },
  { name: "24 tiết khí", desc: "Mỗi tiết 15° kinh độ Mặt Trời · kim vàng là Mặt Trời" },
  { name: "Thước độ", desc: "360 vạch chia và bốn hướng chính" },
  { name: "12 tháng", desc: "Tháng kiến và thập nhị thứ" },
  { name: "Lõi Bắc Đẩu", desc: "Sao Bắc Cực và bốn chòm Bắc Đẩu" },
];

const dateFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
const formatDate = (d: Date) => dateFmt.format(d);

/** "Trăng khuyết đầu" → "khuyết đầu": nhãn bên cạnh đã ghi "Trăng" rồi. Các
 *  tên không bắt đầu bằng "Trăng" ("Sóc (trăng mới)", "Thượng huyền") chỉ bị
 *  hạ chữ hoa đầu dòng. */
const shortPhase = (name: string) => name.replace(/^Trăng\s+/i, "").toLowerCase();

export function LandingPage() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<CompassHandle | null>(null);
  const failedRef = useRef<HTMLDivElement>(null);
  // Thẻ lịch tự tính, không chờ cảnh 3D: có dữ liệu ngay lúc dựng trang (khỏi
  // nhảy bố cục khi cảnh 3D nướng texture xong) và cả trên máy không có WebGL.
  const [cal, setCal] = useState<CompassReadout>(() => readCalendar());
  // Nút VI/EN nằm trong carousel portfolio nhưng chi phối cả dải năng lực
  // trong thẻ "Trợ lý cá nhân", nên ngôn ngữ phải do trang chủ giữ.
  const [lang, setLang] = useState<Lang>("vi");

  const goToChat = () => navigate("/chat");

  useEffect(() => {
    const id = window.setInterval(() => setCal(readCalendar()), CALENDAR_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = createCompass(canvas, {
      backgroundColor: ATOM_BG[theme],
      onFail: () => {
        canvas.style.display = "none";
        if (failedRef.current) failedRef.current.style.display = "flex";
      },
    });
    handleRef.current = handle;
    canvas.classList.add("ready");
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleRef.current?.setBackgroundColor(ATOM_BG[theme]);
  }, [theme]);

  return (
    <div className="atom-landing-frame">
      <div className="atom-landing">
        <div className="atom-page">
          <nav className="atom-nav">
            <div className="atom-brand atom-glass">
              <img src={mainlogo} alt="" className="atom-brand-logo" />
              <span className="logo-name-sm">KiNg</span>
            </div>
            <div className="atom-nav-right">
              <span className="atom-status atom-glass">
                <span className="atom-status-dot" aria-hidden="true" />
                Lõi xử lý trực tuyến · liên tục
              </span>
              <button type="button" className="atom-theme-toggle atom-glass" onClick={toggle}
                aria-label="Đổi giao diện sáng/tối"
                title={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}>
                {theme === "dark"
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>}
              </button>
            </div>
          </nav>

          <main className="atom-top">
            <PortfolioCarousel lang={lang} onLangChange={setLang} />

            <section className="atom-intro atom-glass" aria-labelledby="atom-headline">
              <p className="atom-eyebrow">Trợ lý cá nhân của <span className="atom-eyebrow-name">Kiệt</span></p>
              <h1 id="atom-headline" className="atom-headline">Mọi việc bạn cần,<br /><em>một lời gọi là xong.</em></h1>
              <p className="atom-sub">
                KiNg gộp nghiên cứu, viết code, giải bài tập và đọc tài liệu vào một lõi xử lý
                duy nhất — luôn sẵn sàng, luôn học hỏi.
              </p>
              <div className="atom-intro-foot">
                <button type="button" className="atom-cta" onClick={goToChat}>
                  <span className="atom-cta-text">Mở trợ lý</span>
                </button>
                <div className="atom-core">
                  {CORE_FEATURES.map(f => (
                    <div className="atom-core-row" key={f.k.vi}>
                      <span className="atom-core-k">{f.k[lang]}</span>
                      <span className="atom-core-v">{f.v[lang]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Thẻ lịch: những gì đang sáng trên mặt la bàn bên dưới — ô tiết
                khí, ô tháng kiến, tú Mặt Trăng đang ở — cộng hình trăng theo
                pha thật của hôm nay. */}
            <section className="atom-cal atom-glass" aria-label="Lịch thiên văn hôm nay">
              <div className="atom-cal-head">
                <h2 className="atom-cal-title">Lịch thiên văn</h2>
                <span className="atom-cal-date">{formatDate(cal.date)}</span>
              </div>
              <div className="atom-cal-info">
                <p className="atom-cal-big">{cal.sunLon.toFixed(1)}°</p>
                <p className="atom-cal-caption">kinh độ hoàng đạo của Mặt Trời</p>
                <dl>
                  <div>
                    <dt>Tiết khí</dt>
                    <dd><span className="han">{cal.term[0]}</span> {cal.term[1]}</dd>
                  </div>
                  <div>
                    <dt>Tháng kiến</dt>
                    <dd><span className="han">{cal.month[0]}</span> {cal.month[1]}</dd>
                  </div>
                </dl>
              </div>
              <div className="atom-cal-moon">
                <MoonPhase illumination={cal.illumination} waxing={cal.moonAge < HALF_SYNODIC_DAYS} />
                <p className="atom-cal-moon-phase">
                  {shortPhase(cal.phaseName)} · {Math.round(cal.illumination * 100)}%
                </p>
                <p className="atom-cal-moon-lodge">
                  <span className="han">{cal.lodge[0]}</span> tú {cal.lodge[1]}
                </p>
              </div>
            </section>
          </main>

          <section className="atom-compass atom-glass" aria-labelledby="atom-compass-title">
            <div className="atom-compass-head">
              <div>
                <h2 id="atom-compass-title" className="atom-compass-title">La bàn thiên văn</h2>
                <p className="atom-compass-sub">
                  Sáu vành đồng tâm tự quay ngược chiều nhau, khoá theo ngày giờ hôm nay.
                </p>
              </div>
              <p className="atom-hint">Kéo để xoay · Ctrl/⌘ + cuộn để phóng · nhấp đúp để về nếp</p>
            </div>
            <div className="atom-compass-body">
              <div className="atom-stage">
                <canvas ref={canvasRef} className="atom-canvas" aria-hidden="true" />
                <div className="atom-fallback" ref={failedRef} aria-hidden="true"><div className="atom-orb" /></div>
              </div>
              <ol className="atom-rings" aria-label="Sáu vành của la bàn, từ ngoài vào trong">
                {COMPASS_RINGS.map((r, i) => (
                  <li key={r.name}>
                    <span className="atom-ring-num" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                    <span className="atom-ring-name">{r.name}</span>
                    <span className="atom-ring-desc">{r.desc}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
