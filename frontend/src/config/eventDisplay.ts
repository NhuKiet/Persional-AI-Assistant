import type { CodingEvent } from "../hooks/useCoding";

export interface EventDisplayEntry {
  icon: string | null;
  color: string | null;
  label: (ev: CodingEvent) => string;
}

/** Agent log row display — chỉ hiển thị các milestone quan trọng — thinking/
 *  generating/executing đã được phase bar thể hiện, không cần lặp trong log nữa. */
export const EVENT_DISPLAY: Record<string, EventDisplayEntry> = {
  plan:      { icon: "≡",  color: "#7C9EFF",  label: ev => `Lập kế hoạch ${(ev.steps as unknown[] | undefined)?.length || 0} bước` },
  code:      { icon: "💻", color: null,        label: ev => ev.is_fix ? `🔧 Sửa code lần ${ev.iteration} — ${ev.filename}` : `Code sẵn sàng — ${ev.filename}` },
  output:    { icon: null, color: null,        label: ev => ev.exit_code === 0 ? `✓ Chạy xong (${ev.duration}s)` : `✗ Exit ${ev.exit_code} (${ev.duration}s)` },
  debugging: { icon: "⟳",  color: "#E8A0FF",  label: ev => `Debug lần ${ev.iteration}/${ev.max_iter || 4}` },
  done:      { icon: null, color: null,        label: ev => ev.message as string },
  error:     { icon: "⚠",  color: "#FF8585",  label: ev => ev.message as string },
};
