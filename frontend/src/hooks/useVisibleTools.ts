import { useEffect, useMemo, useState } from "react";
import { TOOLS, type Tool } from "../config/tools";
import { API, apiFetch } from "../lib/api";
import { useAuth } from "./useAuth";

/** The tools to offer this visitor, in TOOLS order: every tool that isn't
 *  hidden, plus the ones that run generated code (`needsSandbox`) when the
 *  visitor is the owner and this backend can actually run it — the Docker
 *  sandbox answers, which is the case when the backend runs on the machine
 *  itself. The compose, Railway and public-link builds have no sandbox, so
 *  Coding stays out of sight there; /coding itself still opens. Asked once
 *  per mount: a sandbox started later shows up on the next page load. */
export function useVisibleTools(): Tool[] {
  const { state, loading } = useAuth();
  // Not before /api/auth/me answers: until then everyone looks like the owner.
  const owner = !loading && state.role === "owner";
  const [sandbox, setSandbox] = useState(false);

  useEffect(() => {
    if (!owner) return;
    let live = true;
    apiFetch(`${API}/api/coding/status`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (live) setSandbox(data?.executor?.available === true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [owner]);

  const withSandbox = owner && sandbox;
  return useMemo(
    () => TOOLS.filter(tool => !tool.hidden && (!tool.needsSandbox || withSandbox)),
    [withSandbox],
  );
}
