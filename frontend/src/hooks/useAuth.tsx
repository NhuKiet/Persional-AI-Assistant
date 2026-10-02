import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AUTH_CHANGED, fetchMe, OPEN, type AuthState } from "../lib/auth";

interface AuthContextValue {
  state: AuthState;
  /** True until the first answer from /api/auth/me. */
  loading: boolean;
  refresh: () => Promise<void>;
  set: (state: AuthState) => void;
}

// Without a provider (a page rendered on its own in a test): the open app.
const AuthContext = createContext<AuthContextValue>({
  state: OPEN,
  loading: false,
  refresh: async () => {},
  set: () => {},
});

/** Who the visitor is — owner or guest — for the whole app. Asked once on
 *  load, and again whenever apiFetch signals it may have changed (a trial
 *  turn spent, a request refused). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(OPEN);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setState(await fetchMe());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(AUTH_CHANGED, onChange);
    return () => window.removeEventListener(AUTH_CHANGED, onChange);
  }, [refresh]);

  const value = useMemo(() => ({ state, loading, refresh, set: setState }), [state, loading, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
