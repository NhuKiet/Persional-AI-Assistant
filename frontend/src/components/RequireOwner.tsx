import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { loginHref } from "./GuestBanner";

interface RequireOwnerProps {
  /** Shown in the heading: "<feature> cần đăng nhập". */
  feature: string;
  children: ReactNode;
}

/** A page only the owner may use. A guest gets a short explanation and the
 *  way in instead — the backend refuses these routes to guests anyway
 *  (backend/app/core/auth.py); this is so the page says why. */
export function RequireOwner({ feature, children }: RequireOwnerProps) {
  const { state, loading } = useAuth();
  const { pathname } = useLocation();
  // Until we know: render nothing, not the page — a guest would see it flash
  // and its first requests go out before the lock appears.
  if (loading) return null;
  if (state.role !== "guest") return <>{children}</>;

  const tried = state.guest?.enabled;
  return (
    <main className="locked-page">
      <div className="locked-card">
        <span className="locked-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <h1 className="locked-title">{feature} cần đăng nhập</h1>
        <p className="locked-text">
          {tried
            ? "Tính năng này chỉ dành cho chủ trợ lý. Bạn vẫn có thể dùng thử Chat, PDF và Công thức viết tay."
            : "Tính năng này chỉ dành cho chủ trợ lý."}
        </p>
        <div className="locked-actions">
          <Link className="locked-primary" to={loginHref(pathname)}>Đăng nhập</Link>
          {tried && <Link className="locked-secondary" to="/chat">Dùng thử Chat</Link>}
        </div>
      </div>
    </main>
  );
}
