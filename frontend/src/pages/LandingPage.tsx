import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import mainlogo from "../assets/mainlogo.png";
import { TOOLS, toolPath } from "../config/tools";

/** Trang chủ thật — trước đây "/" đi thẳng vào ô chat (HomePage, giờ ở /chat),
 *  không có gì giới thiệu app trước khi vào. Trang này lấp chỗ đó: một câu
 *  thesis, ô nhập để vào thẳng chat kèm câu hỏi đầu tiên, và bảng 6 công cụ
 *  để vào thẳng route riêng của từng cái — không phải vòng qua /chat trước.
 *
 *  Chữ ký thiết kế: ánh sáng bám con trỏ trên nền kính mờ (xem cursor light
 *  effect ở cuối file). Kính mờ chỉ ra kính khi có ánh sáng chạy qua nó —
 *  blur tĩnh kèm viền trắng chỉ là một hộp xám. Đã thống nhất hướng này với
 *  người dùng qua bản preview.html trước khi áp vào đây. */
export function LandingPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const goToChat = (prefill?: string) => {
    navigate("/chat", prefill ? { state: { prefill } } : undefined);
  };

  const submit = () => {
    const trimmed = query.trim();
    if (trimmed) goToChat(trimmed); else goToChat();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  };

  return (
    <div className="landing">
      <CursorLight />

      <div className="landing-wrap">
        <nav className="ld-nav ld-rise" style={{ "--rd": "0ms" } as CSSProperties}>
          <div className="ld-brand">
            <img src={mainlogo} alt="" className="ld-brand-logo" />
            <span className="logo-name-sm">KiNg</span>
          </div>
          <button type="button" className="ld-cta" onClick={() => goToChat()}>Mở trợ lý</button>
        </nav>

        <header className="ld-hero">
          <p className="ld-eyebrow ld-rise" style={{ "--rd": "60ms" } as CSSProperties}>Trợ lý AI cá nhân</p>
          <h1 className="ld-headline ld-rise" style={{ "--rd": "120ms" } as CSSProperties}>
            Sáu công cụ.<br /><em>Một chỗ làm việc.</em>
          </h1>
          <p className="ld-sub ld-rise" style={{ "--rd": "180ms" } as CSSProperties}>
            Nghiên cứu, viết code, giải bài tập, đọc PDF — tất cả bắt đầu từ một ô nhập duy nhất.
          </p>

          <div className="ld-input-wrap ld-rise" style={{ "--rd": "240ms" } as CSSProperties}>
            <div className="ld-input-glass">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Hỏi KiNg bất cứ điều gì…"
                aria-label="Hỏi KiNg bất cứ điều gì"
              />
              <button type="button" className="ld-send" onClick={submit} aria-label="Gửi">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                  <path d="M1 7.5h13M8 1.5l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <p className="ld-rack-label ld-rise" style={{ "--rd": "280ms" } as CSSProperties}>Chọn công cụ</p>
        <div className="ld-rack">
          {TOOLS.map((tool, i) => (
            <button
              key={tool.id}
              type="button"
              className="ld-tool ld-rise"
              style={{ "--tint": tool.color, "--rd": `${300 + i * 40}ms` } as CSSProperties}
              title={tool.desc}
              onClick={() => navigate(toolPath(tool))}
            >
              <div className="ld-tool-top">
                <span className="ld-tool-icon">{tool.icon}</span>
                <span className="ld-tool-name">{tool.label}</span>
              </div>
              <p className="ld-tool-desc">{tool.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Nguồn sáng bám con trỏ, throttle qua rAF để không ghì layout mỗi
 *  pointermove. Tắt hẳn dưới prefers-reduced-motion — dù đây không phải một
 *  animation lặp, một quầng sáng đuổi theo con trỏ vẫn có thể gây khó chịu
 *  cho người nhạy cảm với chuyển động. */
function CursorLight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (el) {
          el.style.setProperty("--mx", `${(e.clientX / window.innerWidth) * 100}%`);
          el.style.setProperty("--my", `${(e.clientY / window.innerHeight) * 100}%`);
        }
        raf = 0;
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <div className="ld-light" ref={ref} />;
}
