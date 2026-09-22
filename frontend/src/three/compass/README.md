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

Project gốc còn có `main.js`, `ui/app.js` (bảng điều khiển) và
`anim/timeline.js` (chế độ phát animation 14 giây). Trang chủ không có bảng
điều khiển nên các module đó bị bỏ; `index.ts` thay chỗ `main.js`.

## Lớp lịch

`astro/calendar.js` + `scene/markers.js` CÓ được port: kim chỉ cố định ở đỉnh
khung (vị trí Mặt Trời), kim Mặt Trăng trên vành 28 tú, và ba ô sáng ứng với
tiết khí / tháng kiến / tú hiện tại.

Khác một điểm so với bản gốc. Bản gốc ghim kim Mặt Trời CỐ ĐỊNH ở đỉnh khung
rồi xoay cả đĩa sao cho vị trí Mặt Trời trồi lên đúng dưới nó — nên bật lịch là
phải khoá cả bốn vành và tắt hẳn vành tự quay. Ở đây làm ngược lại: không khoá
vành nào, gắn kim vào chính vành lịch (L1) và xoay nó đi `-plateSpin`, nên kim
bám đúng ô tiết khí hiện tại dù vành xoay tới đâu. Đổi lại quy ước "Mặt Trời
luôn ở đỉnh khung", nhưng cả bốn vành cùng quay.

Kiểm lại được: nếu vành đang ở `spin = plateSpin` (đúng trạng thái khoá của bản
gốc) thì tổng góc bằng 0 và kim về đỉnh khung, khớp y hệt hành vi cũ. Xem
`SUN_INDEX_RADIUS` và `applyCalendar()` trong index.ts.

Bảng đọc số (ngày, kinh độ Mặt Trời, tên tiết khí, pha trăng) thì KHÔNG được
port — nó nằm trong `ui/app.js`. Trên trang chủ lớp lịch chỉ là hình.

## Đồng bộ lại từ project gốc

Copy lại đúng các file `.js` hiện có trong thư mục này, rồi chạy
`npm run typecheck` và `npm run build`. Nếu project gốc thêm module mới mà
module đã port lại `import` tới, phải copy thêm module đó — các file ở đây
không import gì ngoài `three` và lẫn nhau.
