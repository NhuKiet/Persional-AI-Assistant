import { CopyButton } from "../CopyButton";
import type { SandboxStatus } from "../../hooks/useSandboxStatus";

/** "512m" → "512 MB", as Docker's --memory values are written. */
function formatMemory(memory: string): string {
  const match = /^(\d+(?:\.\d+)?)\s*([kmg])b?$/i.exec(memory.trim());
  return match ? `${match[1]} ${match[2].toUpperCase()}B` : memory;
}

function limitsOf(status: SandboxStatus): string[] {
  return [
    status.network ? "" : "không có mạng",
    status.timeout_s ? `tối đa ${status.timeout_s} giây` : "",
    status.memory ? `${formatMemory(status.memory)} RAM` : "",
  ].filter(Boolean);
}

/** Sandbox up: a quiet note of the limits every run gets — they explain
 *  why `requests.get` or a two-minute loop fails. */
export function SandboxBadge({ status }: { status: SandboxStatus }) {
  const limits = limitsOf(status);
  return (
    <span className="sandbox-badge" title={`Code chạy trong container Docker cách ly: ${limits.join(", ")}.`}>
      <span className="sandbox-dot" aria-hidden="true" />
      Sandbox
      <span className="sandbox-badge-limits"> · {limits.slice(0, 2).join(" · ")}</span>
    </span>
  );
}

interface SandboxBannerProps {
  status: SandboxStatus;
  checking: boolean;
  onRecheck: () => void;
}

/** Sandbox down: say so before the user asks for something to run, with
 *  what fixes it. */
export function SandboxBanner({ status, checking, onRecheck }: SandboxBannerProps) {
  const build = `docker build -f Dockerfile.executor -t ${status.image} .`;
  return (
    <div className="sandbox-banner" role="status">
      <span className="sandbox-banner-icon" aria-hidden="true">⚠</span>
      <div className="sandbox-banner-text">
        {status.reason === "image_missing" ? (
          <>
            <strong>Chưa có image sandbox <code>{status.image}</code> để chạy code.</strong>
            <span className="sandbox-banner-cmd">
              Build một lần: <code>{build}</code>
              <CopyButton text={build} className="sandbox-copy" label="Chép" copiedLabel="✓ Đã chép" />
            </span>
          </>
        ) : status.reason === "docker_unavailable" ? (
          <strong>Chưa chạy được code: Docker chưa bật.</strong>
        ) : (
          <strong>Sandbox chạy code chưa sẵn sàng ({status.reason}).</strong>
        )}
        <span>Code chat vẫn lên kế hoạch và viết code, chỉ không chạy thử được.</span>
      </div>
      <button type="button" className="sandbox-recheck" onClick={onRecheck} disabled={checking}>
        {checking ? "Đang kiểm tra…" : "Kiểm tra lại"}
      </button>
    </div>
  );
}
