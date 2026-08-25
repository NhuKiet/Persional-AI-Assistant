# Theme sáng/tối + Composer pill + Mic — Design

**Ngày:** 2026-07-18
**Phạm vi:** Thuần frontend. Không đụng backend, message bubbles, markdown, code block.

## Mục tiêu

1. Thêm chế độ sáng/tối có toggle, lưu preference.
2. Thống nhất mọi ô nhập rời rạc thành một composer pill kiểu ChatGPT.
3. Thêm mic speech-to-text (tiếng Việt) vào composer.
4. Bỏ nút "‹ KiNg" thừa trong header tool; vá cleanup request khi rời trang.

---

## Phần 1 — Hệ thống Theme (sáng/tối)

**Cơ chế token:** Giữ nguyên TÊN mọi CSS custom property trong `base.css`. Tách giá trị
thành 2 lớp:
- `:root` — giá trị tối (mặc định hiện tại, giữ nguyên).
- `:root[data-theme="light"]` — ghi đè giá trị sáng.

Toàn bộ CSS downstream tham chiếu qua `var(--...)` nên chạy nguyên, không sửa.

**Chọn theme:**
- Mặc định theo `prefers-color-scheme` của OS.
- Người dùng bấm toggle → set `data-theme` trên `<html>` + lưu `localStorage["king-theme"]`.
- Lần load sau: đọc localStorage trước; nếu chưa có thì theo OS.
- Áp `data-theme` **trước khi React render** (script nhỏ trong `index.html` hoặc đầu `main.tsx`)
  để tránh nháy sáng→tối (FOUC).

**Hook mới** `useTheme` (`hooks/useTheme.ts`): trả `{ theme, toggle }`, đồng bộ
`data-theme` + localStorage.

**Nút toggle:** đặt ở **footer sidebar** (cạnh "Xóa tất cả lịch sử"), icon mặt trời/trăng.
Sidebar có mặt mọi trang → nút xuất hiện khắp nơi.

**Giá trị lớp sáng cần định nghĩa** (đảo elevation: canvas sáng nhất, panel nổi có bóng nhẹ):
- Thang nền `--bg` (sáng nhất) → `--bg2/3/4` (đậm dần cho surface/hover).
- `--glass`, `--glass-hi`, `--glass-lit`: nền kính tối nhẹ trên nền sáng (rgba đen alpha thấp).
- `--border`, `--border2`: rgba đen alpha thấp.
- `--shadow-1/2`: nhạt hơn (nền sáng không nuốt bóng).
- `--text/text2/text3`: đảo về tối, giữ tương phản ≥ 4.5:1 trên `--bg2` sáng.
- `--accent-soft`: tint teal nhạt trên nền sáng.

**Kiểm lại:** film-grain overlay (`body::before`) và hiệu ứng ánh sáng landing
(`CursorLight`) không làm nền sáng bị bẩn. Accent teal `#1ed1c2` giữ nguyên cả 2 theme.

---

## Phần 2 — Composer pill dùng chung

Viết lại `InputBar.tsx` thành composer chuẩn duy nhất.

**Bố cục 1 hàng (pill):**
```
[+]  «textarea: Hỏi KiNg…»        [ModelPicker ⌄]  🎤  ⏺send
```
- `+` (đính kèm): chỉ hiện khi có `onAttach` prop (Coding/PDF). Home/Research/Tool ẩn.
- `textarea`: tự giãn cao; Enter gửi, Shift+Enter xuống dòng (giữ logic cũ).
- ModelPicker: dời vào cụm phải qua slot `tools`.
- `🎤` mic: xem Phần 3. Ẩn nếu trình duyệt không hỗ trợ.
- `⏺` send: nút **tròn nền accent**, mũi tên; đang stream → nút dừng (vuông).

**Bỏ layout 2 tầng** `input-bar-stacked` — mọi thứ 1 hàng, cụm công cụ trôi phải.
Pill bo tròn mạnh (~26px), giãn xuống khi text dài.

**Thống nhất toàn app:**
- Research: thay `rs-bar`/`rs-input` → `InputBar`.
- Coding & PDF: ô nhập riêng restyle theo cùng CSS pill (class dùng chung) + thêm mic;
  giữ vùng upload đặc thù, đấu nối `+` vào flow upload sẵn có.

**Giữ nguyên:** message bubbles, markdown, code block.

**CSS:** class `.input-bar` (+ biến thể) trong `chat.css` được viết lại; coding/pdf input
trỏ về cùng class hoặc token dùng chung để không lặp.

---

## Phần 3 — Mic (speech-to-text)

**Công nghệ:** Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) — client-only,
miễn phí, không backend.

**Hook mới** `useSpeechRecognition` (`hooks/useSpeechRecognition.ts`):
- Trả `{ supported, listening, start, stop }`; bắn transcript qua callback.
- `lang = "vi-VN"`, `continuous`, `interimResults` (hiện chữ tạm khi đang nói).
- Cleanup: `stop()` + hủy recognition khi unmount.

**Hành vi UI:**
- Bấm 🎤 → nghe; transcript **nối vào** textarea đang có (không ghi đè).
- Bấm lại / ngừng nói → dừng. Đang nghe: nút mic nhấp nháy màu accent.
- Quyền mic: trình duyệt tự xin (không tự xử lý).
- Fallback: `!supported` → ẩn hẳn nút mic.

**Kiểm thử:** cần Chrome/Edge thật + micro (user test). Tôi verify: nút render đúng,
`supported` detect đúng, UI đổi trạng thái start/stop.

---

## Phần 4 — Bỏ nút "‹ KiNg" + vá cleanup

- Xóa `back-btn` khỏi header 4 trang: Research, Coding, PDF, ToolPage. Header còn:
  `[icon + tên tool] … [ModelPicker] [Reset]`, căn lại flexbox.
- Gỡ plumbing `onBack`: prop `onBack` ở 4 trang + wrapper `withBack` trong `App.tsx` →
  xóa. Về nhà chỉ qua "Trang chủ" trong sidebar (đã có).
- **Vá cleanup:** back-btn cũ gọi `abort()`/`reset()` trước khi rời trang; nút "Trang chủ"
  sidebar thì không → rời qua sidebar để request chạy ngầm. Fix: chuyển `abort()` vào
  cleanup unmount (`useEffect` return) trong `useResearch`/`useCoding` — rời trang đường nào
  cũng tự hủy.

---

## Bảng file đụng tới

| # | Việc | File |
|---|------|------|
| 1 | Theme | `styles/base.css`, `hooks/useTheme.ts` (mới), `components/Sidebar.tsx`, `main.tsx`/`index.html` |
| 2 | Composer | `components/InputBar.tsx`, `styles/chat.css`, `pages/{Research,Coding,Pdf,Tool}Page.tsx` |
| 3 | Mic | `hooks/useSpeechRecognition.ts` (mới), `components/InputBar.tsx` |
| 4 | Back + cleanup | `App.tsx`, `pages/{Research,Coding,Pdf,Tool}Page.tsx`, `hooks/useResearch.ts`, `hooks/useCoding.ts` |

## Kiểm thử

- `npm run typecheck` sạch.
- `npm run test` pass (cập nhật test nào chạm InputBar/routes nếu vỡ).
- Verify trực quan trên preview: toggle sáng/tối mọi trang, composer render đúng, mic
  detect `supported`, header không còn nút back.
- Mic thu âm thật: user test trên Chrome.
