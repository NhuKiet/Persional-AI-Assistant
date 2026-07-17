import { useEffect, useRef, useState } from "react";
import { API } from "./lib/api";
import type { ModelSelection } from "./types";

export interface ModelOption extends ModelSelection {
  label: string;
}

export function useModels() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [def, setDef] = useState<ModelSelection | null>(null);

  useEffect(() => {
    fetch(`${API}/api/models`)
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models || []);
        setDef(d.default || null);
      })
      .catch(() => {});
  }, []);

  return { models, def };
}

// Lưu lựa chọn theo tool trong localStorage: "model:<tool>" -> "provider|model"
export function loadSelection(tool: string, fallback: ModelSelection | null): ModelSelection | null {
  const raw = localStorage.getItem(`model:${tool}`);
  if (!raw) return fallback;
  const [provider, model] = raw.split("|");
  return { provider, model };
}

export function saveSelection(tool: string, sel: ModelSelection) {
  localStorage.setItem(`model:${tool}`, `${sel.provider}|${sel.model}`);
}

const keyOf = (s: ModelSelection) => `${s.provider}|${s.model}`;

interface ModelPickerProps {
  tool: string;
  value: ModelSelection | null;
  onChange: (sel: ModelSelection | null) => void;
}

/** Dropdown tự dựng, không dùng <select>.
 *
 *  Lý do bỏ <select>: phần danh sách xổ xuống của select do hệ điều hành vẽ,
 *  CSS không với tới được — không thể cho nó nền kính, bo góc hay màu accent
 *  đồng bộ với phần còn lại của app.
 *
 *  Đổi lại, mọi thứ <select> cho không thì giờ phải tự làm: role/aria, điều
 *  hướng bàn phím, đóng khi bấm ra ngoài, đóng khi nhấn Escape. Theo đúng
 *  mẫu combobox của ARIA APG: trigger giữ role="combobox" (đây cũng là thứ
 *  app.smoke.test.jsx tìm bằng findByRole("combobox") — đừng bỏ), popover là
 *  role="listbox", mỗi dòng là role="option" + aria-selected.
 */
export default function ModelPicker({ tool, value, onChange }: ModelPickerProps) {
  const { models, def } = useModels();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value && def) onChange(loadSelection(tool, def));
  }, [def]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard: một lựa chọn đã lưu trong localStorage (hoặc `value` truyền vào) có
  // thể trỏ tới provider/model không còn trong danh sách models nữa (ví dụ API
  // key bị gỡ). Khi đó quay về default của server.
  useEffect(() => {
    if (!models.length || !value) return;
    const isAvailable = models.some((m) => m.provider === value.provider && m.model === value.model);
    if (!isAvailable && def) {
      saveSelection(tool, def);
      onChange(def);
    }
  }, [models, value, def]); // eslint-disable-line react-hooks/exhaustive-deps

  // Đóng khi bấm ra ngoài. pointerdown chứ không phải click: bắt sớm hơn, nên
  // không bị hụt khi con trỏ nhả ra ngoài một phần tử đã bị unmount.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!models.length) return null;

  const currentKey = value ? keyOf(value) : "";
  const current = models.find((m) => keyOf(m) === currentKey);
  const label = current?.label ?? "Chọn model";

  const pick = (m: ModelOption) => {
    const sel = { provider: m.provider, model: m.model };
    saveSelection(tool, sel);
    onChange(sel);
    setOpen(false);
  };

  /** Chọn hướng mở ngay lúc mở, không hardcode.
   *  Cùng một component đứng ở hai chỗ ngược nhau: trong composer sát đáy màn
   *  hình (Home, Tool) thì phải mở lên, còn ở tool-header trên đỉnh trang
   *  (Research, Coding, PDF) thì phải mở xuống. Cố định một hướng là chắc chắn
   *  bị cắt mất ở một trong hai chỗ. Đo khoảng trống thật phía dưới trigger:
   *  không đủ cho danh sách thì lật lên. */
  const LIST_MAX = 240; // khớp max-height của .mp-list trong chat.css
  const openAt = (i: number) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setDropUp(window.innerHeight - r.bottom < LIST_MAX && r.top > LIST_MAX);
    setActive(i);
    setOpen(true);
  };
  const currentIndex = Math.max(0, models.findIndex((m) => keyOf(m) === currentKey));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openAt(currentIndex);
      }
      return;
    }
    if (e.key === "Escape")      { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % models.length); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); setActive((i) => (i - 1 + models.length) % models.length); }
    else if (e.key === "Home")      { e.preventDefault(); setActive(0); }
    else if (e.key === "End")       { e.preventDefault(); setActive(models.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(models[active]); }
    else if (e.key === "Tab")       { setOpen(false); }
  };

  const listId = `model-list-${tool}`;

  return (
    <div className="mp" ref={rootRef}>
      <button
        type="button"
        role="combobox"
        className="mp-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={`Model: ${label}`}
        onClick={() => (open ? setOpen(false) : openAt(currentIndex))}
        onKeyDown={onKeyDown}
      >
        <span className="mp-value">{label}</span>
        <svg className="mp-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul className={`mp-list${dropUp ? " mp-up" : " mp-down"}`} id={listId} role="listbox" aria-label="Chọn model">
          {models.map((m, i) => {
            const selected = keyOf(m) === currentKey;
            return (
              <li
                key={keyOf(m)}
                role="option"
                aria-selected={selected}
                className={`mp-option${i === active ? " mp-active" : ""}${selected ? " mp-selected" : ""}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(m)}
              >
                <span className="mp-option-label">{m.label}</span>
                {selected && (
                  <svg className="mp-check" width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                    <path d="M2 5.5L4.5 8L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
