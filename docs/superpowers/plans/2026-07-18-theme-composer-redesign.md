# Theme sáng/tối + Composer pill + Mic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm chế độ sáng/tối có toggle, thống nhất mọi ô nhập thành composer pill kiểu ChatGPT có mic (speech-to-text tiếng Việt), và bỏ nút "‹ KiNg" thừa trong header tool.

**Architecture:** Thuần frontend React/TS. Theme qua `data-theme` trên `<html>` + CSS custom properties 2 lớp trong `base.css`. Mic qua Web Speech API bọc trong hook + component `MicButton` tái dùng. Composer `InputBar` viết lại thành pill; các trang tool dùng chung class CSS + `MicButton`.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + Testing Library, CSS custom properties, Web Speech API.

## Global Constraints

- TypeScript: `npm run typecheck` (tsc --noEmit) phải sạch sau mỗi task.
- Test: `npm run test` (vitest run) phải xanh sau mỗi task.
- Không đụng backend, message bubbles, markdown, code block.
- Tất cả lệnh chạy trong thư mục `frontend/`.
- Giữ nguyên TÊN mọi CSS custom property — chỉ tách/thêm giá trị theo theme.
- Accent thương hiệu `#1ed1c2` giữ nguyên cả 2 theme.
- Tiếng Việt: mic dùng `lang = "vi-VN"`.

---

### Task 1: Theme tokens + useTheme hook + no-FOUC script

**Files:**
- Modify: `frontend/src/styles/base.css` (thêm khối `:root[data-theme="light"]`)
- Create: `frontend/src/hooks/useTheme.ts`
- Modify: `frontend/index.html` (thêm inline script set data-theme trước khi React render)
- Test: `frontend/src/test/useTheme.test.tsx`

**Interfaces:**
- Produces: `useTheme(): { theme: "light" | "dark"; toggle: () => void }` — đọc/ghi `localStorage["king-theme"]`, đồng bộ `document.documentElement.dataset.theme`.

- [ ] **Step 1: Thêm khối light theme vào base.css**

Mở `frontend/src/styles/base.css`, ngay SAU khối `:root { ... }` hiện có (kết thúc trước comment `/* ── 3. Base Layout ── */`), chèn:

```css
/* ── Theme sáng ──────────────────────────────────────────────
   Ghi đè token khi <html data-theme="light">. Đảo thang elevation:
   canvas sáng nhất, bề mặt nổi tối/đậm dần. Giữ cùng TÊN biến nên mọi
   CSS downstream chạy nguyên. Tương phản chữ đo trên --bg2 sáng, giữ ≥ 4.5:1. */
:root[data-theme="light"] {
  --bg:   #ffffff;   /* canvas — nền trang (sáng nhất) */
  --bg2:  #f5f6f8;   /* card, input, panel, sidebar */
  --bg3:  #e9ebef;   /* hover, bề mặt nổi */
  --bg4:  #dfe2e8;   /* inline code (đậm nhất) */

  --glass:      rgba(20, 24, 33, 0.035);
  --glass-hi:   rgba(20, 24, 33, 0.06);
  --glass-lit:  rgba(20, 24, 33, 0.14);

  --border:  rgba(20, 24, 33, 0.10);
  --border2: rgba(20, 24, 33, 0.16);

  --shadow-1: 0 1px 3px rgba(20, 24, 33, 0.10);
  --shadow-2: 0 12px 32px -8px rgba(20, 24, 33, 0.18);

  --text:  #1a1d24;   /* chữ chính */
  --text2: #545860;   /* chữ phụ / label */
  --text3: #787c85;   /* chữ mờ / placeholder */

  --accent-soft: rgba(30, 209, 194, 0.12);

  --sh-keyword: #8b3fd6;
  --sh-string:  #4f7a1f;
  --sh-comment: #8a949c;
  --sh-number:  #c05621;
}
```

- [ ] **Step 2: Viết test cho useTheme**

Tạo `frontend/src/test/useTheme.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "../hooks/useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("mặc định dark khi chưa có preference và OS không phải light", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggle đổi theme, ghi data-theme và localStorage", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("king-theme")).toBe("light");
  });

  it("đọc lại preference đã lưu", () => {
    localStorage.setItem("king-theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận fail**

Run: `npm run test -- useTheme`
Expected: FAIL — "Cannot find module '../hooks/useTheme'".

- [ ] **Step 4: Viết useTheme hook**

Tạo `frontend/src/hooks/useTheme.ts`:

```ts
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "king-theme";

/** Đọc theme khởi tạo: localStorage trước, rồi tới prefers-color-scheme,
 *  mặc định "dark". Khớp với script no-FOUC trong index.html. */
function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme(t => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `npm run test -- useTheme`
Expected: PASS (3 test).

- [ ] **Step 6: Thêm script no-FOUC vào index.html**

Trong `frontend/index.html`, ngay TRƯỚC `<div id="root"></div>`, thêm:

```html
    <script>
      // Set theme trước khi React render để tránh nháy sáng→tối (FOUC).
      // Phải khớp logic initialTheme() trong hooks/useTheme.ts.
      (function () {
        try {
          var t = localStorage.getItem("king-theme");
          if (t !== "light" && t !== "dark") {
            t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
          }
          document.documentElement.dataset.theme = t;
        } catch (e) { document.documentElement.dataset.theme = "dark"; }
      })();
    </script>
```

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck`
Expected: sạch.

```bash
git add frontend/src/styles/base.css frontend/src/hooks/useTheme.ts frontend/index.html frontend/src/test/useTheme.test.tsx
git commit -m "feat(theme): add light theme tokens + useTheme hook + no-FOUC script"
```

---

### Task 2: Nút toggle theme trong Sidebar

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/styles/sidebar.css`
- Test: `frontend/src/test/theme-toggle.test.tsx`

**Interfaces:**
- Consumes: `useTheme()` từ Task 1.
- Produces: nút `button[aria-label="Đổi giao diện sáng/tối"]` trong footer sidebar.

- [ ] **Step 1: Viết test toggle qua UI**

Tạo `frontend/src/test/theme-toggle.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "../App.tsx";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  window.history.pushState({}, "", "/chat");
  vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    const u = String(url);
    const json = u.includes("/api/models")
      ? { models: [{ provider: "ollama", model: "llama3", label: "llama3 (local)" }], default: { provider: "ollama", model: "llama3" } }
      : {};
    return Promise.resolve({ ok: true, json: () => Promise.resolve(json) });
  });
});

it("nút toggle trong sidebar đổi data-theme", async () => {
  const user = userEvent.setup();
  render(<App />);
  const btn = await screen.findByRole("button", { name: /Đổi giao diện sáng\/tối/i });
  const before = document.documentElement.dataset.theme;
  await user.click(btn);
  expect(document.documentElement.dataset.theme).not.toBe(before);
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm run test -- theme-toggle`
Expected: FAIL — không tìm thấy button "Đổi giao diện sáng/tối".

- [ ] **Step 3: Thêm nút toggle vào Sidebar**

Trong `frontend/src/components/Sidebar.tsx`:

Thêm import ở đầu file (sau dòng import `groupByDate`):
```tsx
import { useTheme } from "../hooks/useTheme";
```

Trong thân component, ngay sau `const newBtnLabel = ...`:
```tsx
  const { theme, toggle } = useTheme();
```

Thay khối footer hiện tại:
```tsx
        {sessions.length > 0 && (
          <div className="sb-footer">
            <button className="sb-clear-all" onClick={onClearAll}>Xóa tất cả lịch sử</button>
          </div>
        )}
```
bằng:
```tsx
        <div className="sb-footer">
          <button className="sb-theme-toggle" onClick={toggle}
            aria-label="Đổi giao diện sáng/tối"
            title={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}>
            {theme === "dark"
              ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>}
            <span>{theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}</span>
          </button>
          {sessions.length > 0 && (
            <button className="sb-clear-all" onClick={onClearAll}>Xóa tất cả lịch sử</button>
          )}
        </div>
```

- [ ] **Step 4: Style nút toggle**

Trong `frontend/src/styles/sidebar.css`, ngay sau rule `.sb-clear-all:hover { ... }` (dòng ~196), thêm:

```css
.sb-theme-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  margin-bottom: 4px;
  border-radius: 8px;
  border: none;
  background: none;
  color: var(--text2);
  font-family: var(--sans);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.sb-theme-toggle:hover { background: var(--bg3); color: var(--text); }
.sb-theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Step 5: Chạy test + typecheck**

Run: `npm run test -- theme-toggle`
Expected: PASS.
Run: `npm run typecheck`
Expected: sạch.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/styles/sidebar.css frontend/src/test/theme-toggle.test.tsx
git commit -m "feat(theme): add sun/moon theme toggle in sidebar footer"
```

---

### Task 3: useSpeechRecognition hook + MicButton component

**Files:**
- Create: `frontend/src/hooks/useSpeechRecognition.ts`
- Create: `frontend/src/components/MicButton.tsx`
- Test: `frontend/src/test/MicButton.test.tsx`

**Interfaces:**
- Produces: `useSpeechRecognition(opts: { lang?: string; onResult: (text: string) => void }): { supported: boolean; listening: boolean; start: () => void; stop: () => void }`
- Produces: `<MicButton onTranscript={(text: string) => void} disabled?: boolean />` — render nút mic; ẩn (render `null`) khi `!supported`.

- [ ] **Step 1: Viết test MicButton**

Tạo `frontend/src/test/MicButton.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MicButton } from "../components/MicButton";

const original = {
  SR: (window as any).SpeechRecognition,
  webkitSR: (window as any).webkitSpeechRecognition,
};

afterEach(() => {
  (window as any).SpeechRecognition = original.SR;
  (window as any).webkitSpeechRecognition = original.webkitSR;
});

it("ẩn khi trình duyệt không hỗ trợ", () => {
  (window as any).SpeechRecognition = undefined;
  (window as any).webkitSpeechRecognition = undefined;
  const { container } = render(<MicButton onTranscript={() => {}} />);
  expect(container.firstChild).toBeNull();
});

it("hiện nút mic khi hỗ trợ", () => {
  class FakeSR {
    lang = ""; continuous = false; interimResults = false;
    onresult: any = null; onend: any = null;
    start() {} stop() {}
  }
  (window as any).SpeechRecognition = FakeSR;
  render(<MicButton onTranscript={() => {}} />);
  expect(screen.getByRole("button", { name: /giọng nói/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm run test -- MicButton`
Expected: FAIL — không tìm thấy module `../components/MicButton`.

- [ ] **Step 3: Viết useSpeechRecognition hook**

Tạo `frontend/src/hooks/useSpeechRecognition.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  lang?: string;
  onResult: (text: string) => void;
}

/** Bọc Web Speech API. Client-only, không backend. Ẩn khi không hỗ trợ
 *  (Firefox, Safari cũ) — caller kiểm `supported` để không render nút chết. */
export function useSpeechRecognition({ lang = "vi-VN", onResult }: Options) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const supported = Boolean(SR);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    if (!supported) return;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text) onResultRef.current(text);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    return () => { try { rec.stop(); } catch { /* already stopped */ } };
  }, [supported, lang, SR]);

  const start = useCallback(() => {
    if (!recRef.current || listening) return;
    try { recRef.current.start(); setListening(true); } catch { /* start twice */ }
  }, [listening]);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch { /* noop */ }
    setListening(false);
  }, []);

  return { supported, listening, start, stop };
}
```

- [ ] **Step 4: Viết MicButton component**

Tạo `frontend/src/components/MicButton.tsx`:

```tsx
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

interface MicButtonProps {
  /** Nhận đoạn text vừa nhận diện — caller nối vào ô nhập của mình. */
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function MicButton({ onTranscript, disabled }: MicButtonProps) {
  const { supported, listening, start, stop } = useSpeechRecognition({ onResult: onTranscript });
  if (!supported) return null;
  return (
    <button
      type="button"
      className={`mic-btn${listening ? " mic-btn-active" : ""}`}
      onClick={() => (listening ? stop() : start())}
      disabled={disabled}
      aria-label={listening ? "Dừng nhập giọng nói" : "Nhập bằng giọng nói"}
      title={listening ? "Dừng nghe" : "Nói để nhập"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.6"/>
        <path d="M5 11a7 7 0 0 0 14 0M12 18v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
    </button>
  );
}
```

- [ ] **Step 5: Style nút mic**

Trong `frontend/src/styles/chat.css`, ngay TRƯỚC comment `/* ── 9. Tool Header & Suggestions ── */` (dòng ~257), thêm:

```css
/* ── Mic button (speech-to-text) ─────────────────────────── */
.mic-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: none;
  color: var(--text2);
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.mic-btn:hover:not(:disabled) { color: var(--text); background: var(--bg3); }
.mic-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.mic-btn-active {
  color: var(--accent);
  background: var(--accent-soft);
  animation: mic-pulse 1.4s var(--ease) infinite;
}
@keyframes mic-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-soft); }
  50%      { box-shadow: 0 0 0 5px transparent; }
}
```

- [ ] **Step 6: Chạy test + typecheck**

Run: `npm run test -- MicButton`
Expected: PASS (2 test).
Run: `npm run typecheck`
Expected: sạch.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useSpeechRecognition.ts frontend/src/components/MicButton.tsx frontend/src/styles/chat.css frontend/src/test/MicButton.test.tsx
git commit -m "feat(mic): add useSpeechRecognition hook + MicButton component"
```

---

### Task 4: InputBar → pill composer với mic + slot đính kèm

**Files:**
- Modify: `frontend/src/components/InputBar.tsx`
- Modify: `frontend/src/styles/chat.css` (rule `.input-bar` & liên quan)
- Test: `frontend/src/test/InputBar.test.tsx`

**Interfaces:**
- Consumes: `<MicButton>` từ Task 3.
- Produces: `<InputBar onSend onStop streaming placeholder accentColor tools? onAttach? />` — thêm prop optional `onAttach?: () => void` (hiện nút `+` khi có), luôn render `<MicButton>` (tự ẩn nếu không hỗ trợ).

- [ ] **Step 1: Viết test InputBar**

Tạo `frontend/src/test/InputBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { InputBar } from "../components/InputBar";

it("gửi text khi bấm nút gửi", async () => {
  const onSend = vi.fn();
  const user = userEvent.setup();
  render(<InputBar onSend={onSend} streaming={false} onStop={() => {}} placeholder="Nhắn…" />);
  await user.type(screen.getByPlaceholderText("Nhắn…"), "xin chào");
  await user.click(screen.getByRole("button", { name: /gửi/i }));
  expect(onSend).toHaveBeenCalledWith("xin chào");
});

it("hiện nút đính kèm khi có onAttach", () => {
  render(<InputBar onSend={() => {}} streaming={false} onStop={() => {}} onAttach={() => {}} />);
  expect(screen.getByRole("button", { name: /đính kèm/i })).toBeInTheDocument();
});

it("không hiện nút đính kèm khi không có onAttach", () => {
  render(<InputBar onSend={() => {}} streaming={false} onStop={() => {}} />);
  expect(screen.queryByRole("button", { name: /đính kèm/i })).toBeNull();
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm run test -- InputBar`
Expected: FAIL — nút "đính kèm" chưa tồn tại (test 2 đỏ).

- [ ] **Step 3: Viết lại InputBar**

Thay TOÀN BỘ nội dung `frontend/src/components/InputBar.tsx`:

```tsx
import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { MicButton } from "./MicButton";

interface InputBarProps {
  onSend: (text: string) => void;
  streaming: boolean;
  onStop: () => void;
  placeholder?: string;
  accentColor?: string;
  /** Cụm công cụ (ModelPicker) đặt bên trái nút gửi. Không truyền thì không render. */
  tools?: ReactNode;
  /** Có thì hiện nút "+" đính kèm (chỉ trang có upload). Không thì ẩn. */
  onAttach?: () => void;
}

export function InputBar({ onSend, streaming, onStop, placeholder, accentColor, tools, onAttach }: InputBarProps) {
  const [val, setVal] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => {
    if (streaming) { onStop(); return; }
    if (!val.trim()) return;
    onSend(val.trim()); setVal("");
  };
  return (
    <div className="input-bar">
      {onAttach && (
        <button type="button" className="input-attach" onClick={onAttach} aria-label="Đính kèm file">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      )}
      <textarea ref={ref} className="input-textarea" value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder={placeholder || "Nhắn tin…"} rows={1} />
      <div className="input-actions">
        {tools && <div className="input-tools">{tools}</div>}
        <MicButton onTranscript={t => setVal(v => (v ? v + " " + t : t))} disabled={streaming} />
        <button className="input-send" onClick={submit} style={{ background: streaming ? "#2a2a2e" : accentColor }}
          aria-label={streaming ? "Dừng" : "Gửi"}>
          {streaming
            ? <span style={{ fontSize: 12, color: "#fff" }}>■</span>
            : <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M1 7.5h13M8 1.5l6 6-6 6" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Cập nhật CSS composer thành pill**

Trong `frontend/src/styles/chat.css`, thay khối từ `.input-bar {` tới hết `.input-tools { ... }` (dòng ~198–225) bằng:

```css
.input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--glass);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  border: 1px solid var(--border2);
  border-radius: 26px;
  padding: 8px 8px 8px 8px;
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.input-bar:focus-within {
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  box-shadow: var(--shadow-1);
}
.input-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.input-tools { display: flex; align-items: center; gap: 6px; min-width: 0; }

.input-attach {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: none;
  color: var(--text2);
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.input-attach:hover { color: var(--text); background: var(--bg3); }
```

Ghi chú: `.input-textarea` giữ nguyên (đã có `flex: 1`); bỏ padding-align cũ bằng cách chỉnh padding textarea nếu cần — thêm vào rule `.input-textarea` hiện có thuộc tính:
```css
  padding: 6px 4px;
  align-self: center;
```
(chèn 2 dòng này vào trong block `.input-textarea { ... }`).

- [ ] **Step 5: Chạy test + typecheck**

Run: `npm run test -- InputBar`
Expected: PASS (3 test).
Run: `npm run test`
Expected: toàn bộ xanh (smoke test vẫn dùng InputBar ở /chat và /tool).
Run: `npm run typecheck`
Expected: sạch.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/InputBar.tsx frontend/src/styles/chat.css frontend/src/test/InputBar.test.tsx
git commit -m "feat(composer): rewrite InputBar as pill with mic + optional attach"
```

---

### Task 5: Research — dùng InputBar (pill+mic) + cleanup khi unmount

**Files:**
- Modify: `frontend/src/pages/ResearchPage.tsx`
- Modify: `frontend/src/hooks/useResearch.ts`

**Interfaces:**
- Consumes: `<InputBar>` từ Task 4; `useResearch()` (giữ signature `{ runSearch, abort }`).

- [ ] **Step 1: Thêm cleanup abort khi unmount vào useResearch**

Trong `frontend/src/hooks/useResearch.ts`:

Đổi dòng import đầu:
```ts
import { useRef, useCallback } from "react";
```
thành:
```ts
import { useRef, useCallback, useEffect } from "react";
```

Ngay TRƯỚC `const abort = useCallback(...)` (gần cuối hook), thêm:
```ts
  // Rời trang bằng đường nào (sidebar "Trang chủ", đổi route) cũng hủy stream
  // đang chạy — không để request nghiên cứu chạy ngầm lãng phí.
  useEffect(() => () => abortRef.current?.abort(), []);
```

- [ ] **Step 2: Thay rs-bar bằng InputBar trong ResearchPage**

Trong `frontend/src/pages/ResearchPage.tsx`:

Thêm import (đã có dòng `import { InputBar } ...` — kiểm tra; nếu chưa thì thêm sau import ModelPicker):
```tsx
import { InputBar } from "../components/InputBar";
```
(đã tồn tại theo file hiện tại — không thêm trùng.)

Thay khối `<div className="rs-bar"> ... </div>` (input + button rs-btn) bằng:
```tsx
      <div className="input-wrap" style={{ paddingBottom: 12 }}>
        <InputBar
          onSend={q => handleSearch(q)}
          streaming={isLoading}
          onStop={() => abort()}
          placeholder="Nhập chủ đề nghiên cứu…"
          accentColor={accentColor}
        />
      </div>
```

Xoá các dòng không còn dùng: `const [query, setQuery] = useState("");`, `const inputRef = useRef<HTMLInputElement>(null);`, và `useEffect(() => { inputRef.current?.focus(); }, []);` (InputBar tự focus + tự giữ state). Giữ `handleSearch` — nhưng đổi để không phụ thuộc `query` state.

- [ ] **Step 3: Cập nhật handleSearch bỏ phụ thuộc query state**

Tìm hàm `handleSearch` trong ResearchPage. Đảm bảo nó nhận text từ tham số. Nếu bản hiện tại đọc `query` khi không có tham số, sửa chữ ký thành nhận bắt buộc text từ InputBar/suggestion. Ví dụ mẫu (điều chỉnh theo body thực tế, giữ nguyên phần chạy `runSearch`):

```tsx
  const handleSearch = useCallback((q: string) => {
    const text = q.trim();
    if (!text || isLoading) return;
    // ... phần tạo message slot + gọi runSearch giữ NGUYÊN như cũ, dùng `text` thay `query` ...
  }, [/* giữ deps cũ, bỏ query nếu có */]);
```

Suggestion pill đã gọi `handleSearch(s)` nên không đổi. Nút abort dùng `abort` từ hook (đã destructure).

- [ ] **Step 4: Xoá abort() khỏi abort() trùng lặp nếu có — kiểm tra `abort` đã được destructure**

Đảm bảo đầu component có:
```tsx
  const { runSearch, abort } = useResearch();
```
(đã có theo file hiện tại.)

- [ ] **Step 5: Chạy test + typecheck**

Run: `npm run test`
Expected: smoke test "mở Research" tìm placeholder `/Nhập chủ đề nghiên cứu/i` — vẫn PASS (InputBar render textarea với placeholder đó).
Run: `npm run typecheck`
Expected: sạch. Nếu báo `query`/`inputRef`/`setQuery` unused → xoá hẳn khai báo còn sót.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ResearchPage.tsx frontend/src/hooks/useResearch.ts
git commit -m "feat(research): use pill InputBar + abort stream on unmount"
```

---

### Task 6: Coding — thêm MicButton vào ô nhập + cleanup khi unmount

**Files:**
- Modify: `frontend/src/pages/CodingPage.tsx`
- Modify: `frontend/src/hooks/useCoding.ts`

**Interfaces:**
- Consumes: `<MicButton>` từ Task 3.

- [ ] **Step 1: Thêm cleanup abort khi unmount vào useCoding**

Trong `frontend/src/hooks/useCoding.ts`:

Đổi import đầu:
```ts
import { useState, useRef, useCallback } from "react";
```
thành:
```ts
import { useState, useRef, useCallback, useEffect } from "react";
```

Ngay TRƯỚC `const reset = useCallback(...)`, thêm:
```ts
  // Rời trang bằng đường nào cũng hủy agent đang chạy (không xóa session ở đây
  // — reset() mới xóa; unmount chỉ cần dừng stream để khỏi rò rỉ).
  useEffect(() => () => abortRef.current?.abort(), []);
```

- [ ] **Step 2: Thêm MicButton vào ô nhập Coding**

Trong `frontend/src/pages/CodingPage.tsx`:

Thêm import (sau import ModelPicker):
```tsx
import { MicButton } from "../components/MicButton";
```

Trong khối `<div className="input-bar" ...>` (dòng ~199), ngay TRƯỚC `<button className="input-send" ...>`, chèn:
```tsx
            <MicButton onTranscript={t => setInput(v => (v ? v + " " + t : t))} disabled={isRunning} />
```

- [ ] **Step 3: Chạy test + typecheck**

Run: `npm run test`
Expected: smoke test "mở Coding" vẫn PASS.
Run: `npm run typecheck`
Expected: sạch.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CodingPage.tsx frontend/src/hooks/useCoding.ts
git commit -m "feat(coding): add mic to composer + abort agent on unmount"
```

---

### Task 7: Bỏ nút "‹ KiNg" + gỡ onBack plumbing + mic cho PDF + fix smoke test

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/ResearchPage.tsx`
- Modify: `frontend/src/pages/CodingPage.tsx`
- Modify: `frontend/src/pages/PdfPage.tsx`
- Modify: `frontend/src/pages/ToolPage.tsx`
- Modify: `frontend/src/test/app.smoke.test.jsx`

**Interfaces:**
- Produces: 4 trang tool không còn prop `onBack`; điều hướng về nhà chỉ qua sidebar "Trang chủ".

- [ ] **Step 1: Sửa 2 smoke test đang bấm nút "‹ KiNg"**

Trong `frontend/src/test/app.smoke.test.jsx`, thay 2 test:
- `"quay lại trang chủ từ một tool có route riêng (Research)"`
- `"quay lại trang chủ từ một tool dùng route chung (/tool/:id)"`

Trong cả hai, đổi dòng:
```jsx
    await user.click(await screen.findByRole("button", { name: /KiNg/i }));
```
thành:
```jsx
    await user.click(await screen.findByRole("button", { name: /Trang chủ/i }));
```

(Sidebar có nút "Trang chủ" trên mọi trang tool — đây là đường về nhà duy nhất sau khi bỏ back-btn.) Giữ nguyên phần assert còn lại. Cập nhật luôn comment phía trên test thứ hai nếu nhắc tới `withBack` (không còn đúng).

- [ ] **Step 2: Chạy test để xác nhận fail đúng chỗ**

Run: `npm run test -- app.smoke`
Expected: 2 test vừa sửa vẫn PASS (back-btn còn đó, và nút "Trang chủ" cũng có) — xác nhận test không phụ thuộc back-btn nữa trước khi xóa nó.

- [ ] **Step 3: Gỡ onBack + withBack trong App.tsx**

Trong `frontend/src/App.tsx`:

Xoá hàm `withBack` và 3 dòng tạo route qua nó. Thay:
```tsx
function withBack(Page: ComponentType<{ onBack: () => void }>) {
  return function BackRoute() {
    const navigate = useNavigate();
    return <Page onBack={() => navigate("/")} />;
  };
}

const ResearchRoute = withBack(ResearchPage);
const CodingRoute   = withBack(CodingPage);
const PdfRoute      = withBack(PDFPage);
```
bằng: (xoá hẳn khối trên — các page render thẳng, không cần wrapper)

Trong `ToolRoute`, đổi:
```tsx
  return <ToolPage tool={tool} onBack={() => navigate("/")} />;
```
thành:
```tsx
  return <ToolPage tool={tool} />;
```
và xoá `const navigate = useNavigate();` trong `ToolRoute` nếu không còn dùng (kiểm tra: `Navigate to="/"` dùng component `<Navigate>`, không dùng `navigate()` — nên xoá được).

Trong `<Routes>`, đổi 3 dòng dùng `ResearchRoute/CodingRoute/PdfRoute` thành render page trực tiếp:
```tsx
      <Route path="/research"     element={guarded(<ResearchPage />, "Research")} />
      <Route path="/coding"       element={guarded(<CodingPage />, "Coding")} />
      <Route path="/pdf"          element={guarded(<PDFPage />, "PDF Chat")} />
```

Dọn import không dùng: nếu `useNavigate`, `ComponentType` không còn ai dùng thì xoá khỏi import (typecheck sẽ báo).

- [ ] **Step 4: Bỏ back-btn + prop onBack khỏi ResearchPage**

Trong `frontend/src/pages/ResearchPage.tsx`:
- Xoá khối `<button className="back-btn" ...>...KiNg</button>` trong `<header className="tool-header">`.
- Xoá `onBack` khỏi `interface ResearchPageProps` và khỏi tham số hàm: `export function ResearchPage() {`.
- Nếu `abort()` chỉ còn dùng ở onStop của InputBar thì giữ; không còn tham chiếu `onBack` nào.

- [ ] **Step 5: Bỏ back-btn + onBack khỏi CodingPage**

Trong `frontend/src/pages/CodingPage.tsx`:
- Xoá khối `<button className="back-btn" onClick={() => { reset(); onBack(); }}>...KiNg</button>`.
- Xoá `onBack` khỏi `interface CodingPageProps` và tham số: `export function CodingPage() {`.
- `reset` vẫn dùng cho nút "Reset" (handleNewCoding) — giữ.

- [ ] **Step 6: Bỏ back-btn + onBack khỏi PdfPage + thêm MicButton**

Trong `frontend/src/pages/PdfPage.tsx`:
- Xoá khối `<button className="back-btn" onClick={onBack}>...KiNg</button>`.
- Xoá `onBack` khỏi `interface PDFPageProps` và tham số: `export function PDFPage() {`.
- Thêm import: `import { MicButton } from "../components/MicButton";` (sau import ModelPicker).
- Trong ô nhập PDF (`<div className="input-bar">`, dòng ~314), ngay TRƯỚC `<button className="input-send" ...>`, chèn:
```tsx
                <MicButton onTranscript={t => setInput(v => (v ? v + " " + t : t))} disabled={streaming || summarizing} />
```

- [ ] **Step 7: Bỏ back-btn + onBack khỏi ToolPage**

Trong `frontend/src/pages/ToolPage.tsx`:
- Xoá khối `<button className="back-btn" onClick={onBack}>...KiNg</button>`.
- Xoá `onBack` khỏi `interface ToolPageProps` và tham số: `export function ToolPage({ tool }: ToolPageProps) {`.

- [ ] **Step 8: Căn lại layout header sau khi bỏ back-btn**

Trong `frontend/src/styles/chat.css`, trong rule `.tool-header` (dòng ~260), thêm để tiêu đề nằm trái, cụm control dồn phải:
```css
.tool-header > .tool-title-wrap { margin-right: auto; }
```
(Chèn dòng này ngay sau block `.tool-header { ... }`.)

- [ ] **Step 9: Chạy test + typecheck**

Run: `npm run typecheck`
Expected: sạch (không còn `onBack`, `withBack`, import thừa).
Run: `npm run test`
Expected: toàn bộ xanh (2 test đã chuyển sang nút "Trang chủ").

- [ ] **Step 10: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/ResearchPage.tsx frontend/src/pages/CodingPage.tsx frontend/src/pages/PdfPage.tsx frontend/src/pages/ToolPage.tsx frontend/src/styles/chat.css frontend/src/test/app.smoke.test.jsx
git commit -m "refactor(nav): remove redundant back button, route home via sidebar only"
```

---

### Task 8: Verify trực quan trên preview (không commit code)

**Files:** không sửa file — chỉ kiểm chứng.

- [ ] **Step 1: Chạy đủ 2 gate**

Run: `npm run test` → toàn bộ xanh.
Run: `npm run typecheck` → sạch.

- [ ] **Step 2: Verify trên preview**

Khởi động preview `frontend`, kiểm:
- Toggle sáng/tối ở footer sidebar đổi cả app; reload giữ nguyên theme (localStorage).
- Composer pill hiển thị đúng ở Home, Research, Coding, PDF, Tool — nút gửi tròn, nút mic (nếu Chrome hỗ trợ), nút `+` chỉ ở Coding/PDF.
- Header tool không còn nút "‹ KiNg"; tiêu đề trái, model picker + Reset phải.
- Nút "Trang chủ" sidebar về `/`.
- Không lỗi console.

- [ ] **Step 3: Mic thu âm thật (user test)**

Báo user test nút mic trên Chrome/Edge thật (nói tiếng Việt → chữ nối vào ô nhập). Trong Browser pane có thể không thu được — chỉ verify UI/`supported`.

---

## Self-Review

**Spec coverage:**
- Phần 1 (Theme) → Task 1, 2. ✓
- Phần 2 (Composer pill dùng chung) → Task 4 (InputBar), Task 5 (Research), Task 6 (Coding), Task 7 (PDF). Home/Tool tự ăn qua InputBar. ✓
- Phần 3 (Mic) → Task 3 (hook + MicButton), tích hợp ở Task 4/5/6/7. ✓
- Phần 4 (Bỏ back + cleanup) → Task 5/6 (cleanup unmount), Task 7 (bỏ back + onBack). ✓

**Placeholder scan:** Không có TBD/TODO; mọi step có code hoặc lệnh cụ thể. Task 5 Step 3 mô tả điều chỉnh `handleSearch` theo body thực tế — có mẫu code + ràng buộc rõ (giữ phần runSearch, dùng `text` thay `query`).

**Type consistency:**
- `useTheme(): { theme, toggle }` — dùng nhất quán Task 1↔2.
- `useSpeechRecognition({ lang, onResult }): { supported, listening, start, stop }` — Task 3.
- `<MicButton onTranscript disabled? />` — Task 3, dùng ở Task 4/6/7 cùng chữ ký.
- `<InputBar ... onAttach? />` — Task 4, Research dùng không truyền onAttach (Task 5).
- `setInput`/`setVal` — dùng đúng tên state của từng trang (CodingPage/PdfPage: `setInput`; InputBar nội bộ: `setVal`).
