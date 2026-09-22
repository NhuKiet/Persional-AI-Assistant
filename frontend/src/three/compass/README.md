# compass/ — cảnh 3D "La bàn thiên văn"

Các file `.js` trong thư mục này là **bản port nguyên trạng** từ project độc
lập `la-ban-thien-van` (Vite + three.js thuần). Chúng được giữ nguyên dạng
`.js` một cách có chủ ý, khác với quy ước "file mới trong `frontend/src` phải
là `.ts`":

- đây là mã **vendor**, không phải mã ứng dụng — mục tiêu là diff về không
  khi đồng bộ lại từ project gốc, nên mọi chỉnh sửa ở đây đều là nợ kỹ thuật;
- `tsconfig.json` đang để `allowJs: true, checkJs: false`, nên các file này
  không bị `tsc` kiểm tra, còn TS vẫn suy ra được kiểu cho phía gọi.

Phần **có kiểu** là ranh giới duy nhất mà app chạm vào: [index.ts](index.ts),
xuất `createCompass(canvas, opts)` trả về `CompassHandle` — cùng hình dạng với
`createAtomReactor` trong [../atomReactor.ts](../atomReactor.ts), để
`LandingPage` đổi cảnh chỉ bằng cách đổi import.

## Những gì KHÔNG được port

Project gốc còn có `main.js`, `ui/app.js` (bảng điều khiển), `astro/calendar.js`
(âm lịch / tiết khí / nhị thập bát tú), `anim/timeline.js` (animation 14 giây)
và `scene/markers.js` (kim Mặt Trời / Mặt Trăng). Trang chủ chỉ cần phần nhìn
nên các module đó bị bỏ; `index.ts` thay chỗ `main.js`.

## Đồng bộ lại từ project gốc

Copy lại đúng các file `.js` hiện có trong thư mục này, rồi chạy
`npm run typecheck` và `npm run build`. Nếu project gốc thêm module mới mà
module đã port lại `import` tới, phải copy thêm module đó — các file ở đây
không import gì ngoài `three` và lẫn nhau.
