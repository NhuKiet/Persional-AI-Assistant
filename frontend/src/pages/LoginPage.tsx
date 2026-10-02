import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import mainlogo from "../assets/mainlogo.png";
import { useAuth } from "../hooks/useAuth";
import { login } from "../lib/auth";

/** Only same-site paths: `next` comes from the URL, and an absolute or
 *  protocol-relative value would make this an open redirect. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/chat";
}

export function LoginPage() {
  const { state, loading, set } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already the owner (signed in, or no password on the backend): go on.
  useEffect(() => {
    if (!loading && state.role === "owner" && state.auth) navigate(next, { replace: true });
  }, [loading, state, next, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    const result = await login(password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    set(result.state);
    navigate(next, { replace: true });
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <Link to="/" className="login-brand" aria-label="Về trang chủ">
          <img src={mainlogo} alt="" width={26} height={26} />
          <span className="logo-name-sm">KiNg</span>
        </Link>
        <h1 className="login-title">Đăng nhập</h1>
        {!loading && !state.auth ? (
          <p className="login-note">Máy chủ đang chạy không cần mật khẩu — mọi công cụ đều mở.</p>
        ) : (
          <>
            <p className="login-note">Dành cho chủ trợ lý. Khách vẫn dùng thử được Chat, PDF và Công thức viết tay.</p>
            <label className="login-label" htmlFor="login-password">Mật khẩu</label>
            <input
              id="login-password"
              className="login-input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "login-error" : undefined}
            />
            {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
            <button className="login-submit" type="submit" disabled={busy || !password}>
              {busy ? "Đang đăng nhập…" : "Đăng nhập"}
            </button>
          </>
        )}
        <Link className="login-back" to={state.auth ? "/chat" : next}>
          {state.auth ? "Dùng thử không cần đăng nhập →" : "Vào trợ lý →"}
        </Link>
      </form>
    </main>
  );
}
