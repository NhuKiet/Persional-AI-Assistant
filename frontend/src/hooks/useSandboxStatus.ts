import { useCallback, useEffect, useRef, useState } from "react";
import { API, apiFetch } from "../lib/api";

/** GET /api/coding/status → `executor`. */
export interface SandboxStatus {
  available: boolean;
  /** "ok", "docker_unavailable" or "image_missing". */
  reason: string;
  image: string;
  timeout_s: number;
  memory: string;
  network: boolean;
}

function parseStatus(data: unknown): SandboxStatus | null {
  const executor = (data as { executor?: Partial<SandboxStatus> } | null)?.executor;
  if (!executor || typeof executor.available !== "boolean") return null;
  return {
    available: executor.available,
    reason: String(executor.reason ?? ""),
    image: String(executor.image ?? ""),
    timeout_s: Number(executor.timeout_s) || 0,
    memory: String(executor.memory ?? ""),
    network: Boolean(executor.network),
  };
}

/** Can generated code run — Docker up and the sandbox image built? Asked
 *  when the Coding page opens, so a missing sandbox is said before the user
 *  spends a whole plan-and-generate round finding out. `null` until known,
 *  and stays null if the backend can't be reached: other errors say that. */
export function useSandboxStatus() {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [checking, setChecking] = useState(false);
  // Only the latest check may set state: a slow first answer must not
  // overwrite a newer one.
  const generation = useRef(0);

  const check = useCallback(async (refresh: boolean) => {
    const id = ++generation.current;
    setChecking(true);
    try {
      const response = await apiFetch(`${API}/api/coding/status${refresh ? "?refresh=true" : ""}`);
      const next = response.ok ? parseStatus(await response.json()) : null;
      if (id === generation.current && next) setStatus(next);
    } catch {
      // Keep whatever was known.
    } finally {
      if (id === generation.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check(false);
    return () => { generation.current += 1; };
  }, [check]);

  // Someone who went off to start Docker Desktop comes back to this tab:
  // look again without making them click.
  const down = status !== null && !status.available;
  useEffect(() => {
    if (!down) return;
    const onFocus = () => void check(false);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [down, check]);

  const recheck = useCallback(() => void check(true), [check]);
  return { status, checking, recheck };
}
