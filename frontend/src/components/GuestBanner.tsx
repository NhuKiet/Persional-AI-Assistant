import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/** Sign-in link that brings the visitor back to where they are. */
export function loginHref(path: string): string {
  return `/login?next=${encodeURIComponent(path)}`;
}

/** Over every tool page while a guest is trying the app: how many turns are
 *  left today, and the way to sign in. Nothing at all for the owner, or when
 *  the backend runs without a password. */
export function GuestBanner() {
  const { state } = useAuth();
  const { pathname } = useLocation();
  if (!state.auth || state.role !== "guest" || !state.guest?.enabled) return null;

  const { remaining, limit } = state.guest;
  return (
    <div className={`guest-banner${remaining === 0 ? " is-empty" : ""}`} role="status" aria-label="Chế độ dùng thử">
      <span className="guest-banner-dot" aria-hidden="true" />
      <span>
        {remaining > 0
          ? <>Bạn đang dùng thử — còn {remaining}/{limit} lượt hôm nay.</>
          : <>Hết lượt dùng thử hôm nay.</>}
      </span>
      <Link className="guest-banner-link" to={loginHref(pathname)}>Đăng nhập</Link>
    </div>
  );
}
