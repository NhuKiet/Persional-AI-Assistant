import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import mainlogo from "../assets/mainlogo.png";
import { useTheme } from "../hooks/useTheme";
import { createAtomReactor } from "../three/atomReactor";
import type { AtomReactorHandle } from "../three/atomReactor";

/** Trang chủ — "Capability Reactor": một lõi kim loại 3D bao quanh bởi 3 vành
 *  quỹ đạo, với một làn sóng năng lượng lan tỏa liên tục từ lõi ra từng vành.
 *  Nền 2 lớp: Viền frame ngoài màu trắng (#ffffff) và khối card bên trong màu xanh lá cây (#11660f) bo góc. */
const ATOM_BG = { dark: 0x11660f, light: 0x11660f };

export function LandingPage() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<AtomReactorHandle | null>(null);
  const failedRef = useRef<HTMLDivElement>(null);

  const goToChat = () => navigate("/chat");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = createAtomReactor(canvas, {
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
            <button type="button" className="atom-cta" onClick={goToChat}>Mở trợ lý</button>
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
        <div className="atom-corner atom-corner-br">Lõi năng lực AI<br/>kết xuất · webgl</div>
        <div className="atom-hint">kéo để xoay · cuộn để phóng</div>
      </div>
    </div>
  );
}
