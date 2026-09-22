import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import mainlogo from "../assets/mainlogo.png";
import { useTheme } from "../hooks/useTheme";
import { createCompass } from "../three/compass";
import type { CompassHandle, CompassReadout } from "../three/compass";

/** Trang chủ — "La bàn thiên văn": bốn vành đồng tâm (chòm sao, lịch ngoài,
 *  12 tháng, lõi Bắc Đẩu) vẽ bằng nét sáng, tự quay chậm ngược chiều nhau;
 *  kéo một vành để xoay riêng nó, kéo ngoài đĩa để xoay cả cảnh, cuộn để phóng.
 *  Nền 2 lớp: viền frame ngoài (theo theme) và khối card bên trong bo góc.
 *
 *  Cảnh cũ "Capability Reactor" (three/atomReactor.ts) vẫn còn trong repo và
 *  cùng hình dạng handle — đổi lại chỉ là đổi hai dòng import này.
 *
 *  ATOM_BG là clear color của WebGL, PHẢI trùng --atom-bg trong landing.css —
 *  canvas nằm đè lên card nên lệch một chút là lộ đường ranh. Rêu ô liu trầm
 *  thay cho xanh lá #11660f cũ, xem ghi chú màu ở đầu landing.css. */
const ATOM_BG = { dark: 0x2f3d22, light: 0x2f3d22 };

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
  const [cal, setCal] = useState<CompassReadout | null>(null);

  const goToChat = () => navigate("/chat");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = createCompass(canvas, {
      backgroundColor: ATOM_BG[theme],
      onCalendar: setCal,
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
        <canvas ref={canvasRef} className="atom-canvas" aria-hidden="true" />
        <div className="atom-vignette" aria-hidden="true" />
        <div className="atom-vignette atom-vignette-dark" aria-hidden="true" />
        <div className="atom-fallback" ref={failedRef} aria-hidden="true"><div className="atom-orb" /></div>

        <nav className="atom-nav">
          <div className="atom-brand">
            <img src={mainlogo} alt="" className="atom-brand-logo" />
            <span className="logo-name-sm">KiNg</span>
          </div>
          <div className="atom-nav-right">
            <button type="button" className="atom-theme-toggle" onClick={toggle}
              aria-label="Đổi giao diện sáng/tối"
              title={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}>
              {theme === "dark"
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>}
            </button>
          </div>
        </nav>

        <header className="atom-hero">
          <p className="atom-eyebrow">Trợ lý cá nhân của <span className="atom-eyebrow-name">Kiệt</span></p>
          <h1 className="atom-headline">Mọi việc bạn cần,<br /><em>một lời gọi là xong.</em></h1>
          <p className="atom-sub">
            KiNg gộp nghiên cứu, viết code, giải bài tập và đọc tài liệu vào một lõi xử lý
            duy nhất — luôn sẵn sàng, luôn học hỏi.
          </p>
          <div className="atom-metrics">
            <div className="atom-metric"><div className="k">Công cụ</div><div className="v">Nghiên cứu, code, PDF, tin tức</div></div>
            <div className="atom-metric"><div className="k">Phản hồi</div><div className="v">Trả lời ngay, không chờ</div></div>
            <div className="atom-metric"><div className="k">Bộ nhớ</div><div className="v">Nhớ mạch chuyện đang nói</div></div>
            <div className="atom-metric"><div className="k">Ngôn ngữ</div><div className="v">Nói chuyện như người Việt</div></div>
            <div className="atom-metrics-note">Tổng quan nhanh về KiNg</div>
          </div>
        </header>

        <div className="atom-corner atom-corner-tr">KiNg — lõi xử lý<br/>trực tuyến · liên tục</div>

        {/* Dòng đọc số của la bàn: chính là những gì đang sáng trên mặt đĩa —
            ô tiết khí, ô tháng kiến, tú Mặt Trăng đang ở. Chỉ hiện khi cảnh 3D
            dựng được; máy không có WebGL thì không có gì để chú thích. */}
        {cal && (
          <dl className="atom-readout" aria-label="Lịch thiên văn hôm nay">
            <div>
              <dt>{formatDate(cal.date)}</dt>
              <dd><span className="han">{cal.term[0]}</span> tiết {cal.term[1]}</dd>
            </div>
            <div>
              <dt>Tháng kiến</dt>
              <dd><span className="han">{cal.month[0]}</span> {cal.month[1]}</dd>
            </div>
            <div>
              <dt>Mặt Trời</dt>
              <dd>{cal.sunLon.toFixed(1)}° hoàng đạo</dd>
            </div>
            <div>
              <dt>Trăng</dt>
              <dd>
                <span className="han">{cal.lodge[0]}</span> tú {cal.lodge[1]}
                {" · "}{shortPhase(cal.phaseName)} {Math.round(cal.illumination * 100)}%
              </dd>
            </div>
          </dl>
        )}
        <button type="button" className="atom-cta" onClick={goToChat}>
          <span className="atom-cta-text">Mở trợ lý</span>
        </button>
        <div className="atom-hint">kéo để xoay · cuộn để phóng</div>
      </div>
    </div>
  );
}
