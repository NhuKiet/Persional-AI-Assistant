import mainlogo from "../assets/mainlogo.png";
import { useNavigate } from "react-router-dom";
import { ACCENT } from "../config/theme";
import { groupByDate, type Session } from "../lib/storage";

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
  return (
    <>
      {open && <div className="sb-overlay" onClick={onToggle} />}
      <aside className={`sidebar ${open ? "sb-open" : "sb-closed"}`}>
        <div className="sb-header">
          <div className="sb-logo">
            <img src={mainlogo} alt="logo" style={{ width: 22, height: 22, objectFit: "contain" }} />
            <span className="logo-name-sm" style={{ color: accentColor }}>KiNg</span>
          </div>
          <button className="sb-icon-btn" onClick={onToggle} title="Đóng sidebar">
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

        <button className="sb-new-chat" onClick={onNewChat} style={{ borderColor: accentColor + "44" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          {newBtnLabel}
        </button>

        <div className="sb-list">
          {sessions.length === 0 && (
            <p className="sb-empty">Chưa có cuộc trò chuyện nào</p>
          )}
          {groups.map(group => (
            <div key={group.label} className="sb-group">
              <p className="sb-group-label">{group.label}</p>
              {group.items.map(s => (
                <div key={s.id} className={`sb-item ${s.id === activeId ? "sb-item-active" : ""}`}
                  onClick={() => onSelect(s)}>
                  <span className="sb-item-title">{s.title}</span>
                  <button className="sb-item-del"
                    onClick={e => { e.stopPropagation(); onDelete(s.id); }} title="Xóa">×</button>
                </div>
              ))}
            </div>
          ))}
        </div>

        {sessions.length > 0 && (
          <div className="sb-footer">
            <button className="sb-clear-all" onClick={onClearAll}>Xóa tất cả lịch sử</button>
          </div>
        )}
      </aside>
    </>
  );
}
