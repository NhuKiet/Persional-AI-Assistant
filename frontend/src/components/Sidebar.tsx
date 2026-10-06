import mainlogo from "../assets/mainlogo-256.png";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { loginHref } from "./GuestBanner";
import { useAuth } from "../hooks/useAuth";
import { logout } from "../lib/auth";

import { FEATURES } from "../config/features";
import { ACCENT } from "../config/theme";
import { groupByDate, type Session } from "../lib/storage";
import { useTheme } from "../hooks/useTheme";

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  sessions: Session[];
  activeId: string | null;
  onSelect: (session: Session) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onNewChat: () => void;
  toolLabel?: string;
  toolColor?: string;
}

export function Sidebar({ open, onToggle, sessions, activeId, onSelect, onDelete, onClearAll, onNewChat, toolLabel, toolColor }: SidebarProps) {
  const navigate = useNavigate();
  const groups = groupByDate(sessions);
  const accentColor = toolColor || ACCENT;
  const newBtnLabel = toolLabel ? `${toolLabel} mới` : "Chat mới";
  const { theme, toggle } = useTheme();
  const { state: auth, set: setAuth } = useAuth();
  const { pathname } = useLocation();
  const guest = auth.auth && auth.role === "guest";
  return (
    <>
      {/* Chỉ là nền mờ để bấm ra ngoài; bàn phím đóng sidebar bằng nút ở đầu. */}
      {open && <div className="sb-overlay" aria-hidden="true" onClick={onToggle} />}
      <aside className={`sidebar ${open ? "sb-open" : "sb-closed"}`}>
        <div className="sb-header">
          <div className="sb-logo">
            <img src={mainlogo} alt="logo" style={{ width: 22, height: 22, objectFit: "contain" }} />
            <span className="logo-name-sm" style={{ color: accentColor }}>KiNg</span>
          </div>
          <button className="sb-icon-btn" onClick={onToggle} title="Đóng sidebar" aria-label="Đóng sidebar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <button className="sb-home-link" onClick={() => navigate("/")}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2 6.2 7 2l5 4.2v5.3a.5.5 0 0 1-.5.5H8.7V8.5H5.3V12H2.5a.5.5 0 0 1-.5-.5V6.2Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
          </svg>
          Trang chủ
        </button>

        {FEATURES.news && (
          <button className="sb-home-link" onClick={() => navigate("/news")}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 3.5h10M2 7h10M2 10.5h6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            </svg>
            Tin tức
          </button>
        )}

        <button className="sb-new-chat" onClick={onNewChat} style={{ borderColor: `color-mix(in srgb, ${accentColor} 27%, transparent)` }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          {newBtnLabel}
        </button>

        <div className="sb-list">
          {guest && (
            <p className="sb-empty">Khi dùng thử, lịch sử không được lưu lại.</p>
          )}
          {!guest && sessions.length === 0 && (
            <p className="sb-empty">Chưa có cuộc trò chuyện nào</p>
          )}
          {!guest && groups.map(group => (
            <div key={group.label} className="sb-group">
              <p className="sb-group-label">{group.label}</p>
              {group.items.map(s => (
                <div key={s.id} className={`sb-item ${s.id === activeId ? "sb-item-active" : ""}`}>
                  {/* Nút thật, không phải cả hàng bấm được: Tab tới và Enter mở
                      lại hội thoại cũ. Nó phủ kín hàng nên vùng bấm vẫn như trước. */}
                  <button type="button" className="sb-item-title" onClick={() => onSelect(s)}
                    aria-current={s.id === activeId ? "true" : undefined}>{s.title}</button>
                  <button className="sb-item-del" onClick={() => onDelete(s.id)} title="Xóa">×</button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="sb-footer">
          <button className="sb-theme-toggle" onClick={toggle}
            aria-label="Đổi giao diện sáng/tối"
            title={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}>
            {theme === "dark"
              ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>}
            <span>{theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}</span>
          </button>
          {!guest && sessions.length > 0 && (
            <button className="sb-clear-all" onClick={onClearAll}>Xóa tất cả lịch sử</button>
          )}
          {auth.auth && (auth.role === "owner"
            ? <button className="sb-auth" onClick={async () => setAuth(await logout())}>Đăng xuất</button>
            : <Link className="sb-auth" to={loginHref(pathname)}>Đăng nhập</Link>)}
        </div>
      </aside>
    </>
  );
}
