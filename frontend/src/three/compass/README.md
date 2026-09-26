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

`astro/calendar.js` + `scene/markers.js` CÓ được port: kim chỉ vị trí Mặt Trời,
kim Mặt Trăng trên vành 28 tú, và ba ô sáng ứng với tiết khí / tháng kiến / tú
hiện tại.

Khác một điểm so với bản gốc. Bản gốc ghim kim Mặt Trời CỐ ĐỊNH ở đỉnh khung
rồi xoay cả đĩa sao cho vị trí Mặt Trời trồi lên đúng dưới nó — nên bật lịch là
phải khoá mọi vành và tắt hẳn vành tự quay. Ở đây làm ngược lại: không khoá
vành nào, gắn kim vào chính vành tiết khí (L1b) và xoay nó tới góc
`plateSpin − π/2`, nên kim bám đúng ô tiết khí hiện tại dù vành xoay tới đâu.
Đổi lại quy ước "Mặt Trời luôn ở đỉnh khung", nhưng mọi vành cùng quay.

Kiểm lại được: nếu vành đang ở `spin = plateSpin` (đúng trạng thái khoá của bản
gốc) thì kim chỉ thẳng lên đỉnh khung, khớp y hệt hành vi cũ. Xem `SUN_NEEDLE`
và `applyCalendar()` trong index.ts.

## Vành "lịch ngoài" đã tách làm ba

Bản gốc có bốn vành: L0 chòm sao, **L1 lịch ngoài (0.431–0.8R)**, L2 12 tháng,
L3 lõi. L1 dày gần gấp đôi các vành khác và chứa ba nhóm nội dung không liên
quan nhau, nên ở đây nó được tách thành ba vành độc lập — mỗi vành tự quay,
nghiêng và kéo được riêng:

| id    | nội dung                 | bán kính      |
|-------|--------------------------|---------------|
| `L1a` | thiên can + 28 tú        | 0.667–0.800R  |
| `L1b` | 24 tiết khí              | 0.600–0.667R  |
| `L1c` | 4 hướng + thước chia độ  | 0.431–0.600R  |

Ranh giới đặt đúng tại các vòng đã vẽ sẵn (C8, C11, C13a), nét vẽ giữ nguyên,
nên để phẳng (`phang`) thì mặt đĩa y hệt bản gốc. Kim Mặt Trời vì thế cũng đổi
từ tam giác ở 0.84R thành một kim bán kính nằm trên vành tiết khí (xem
`SUN_NEEDLE` trong index.ts).

Đây là chỗ sửa mã vendor lớn nhất, chạm vào: `config.js` (`LAYERS`,
`LAYER_BY_ID`, `PRESETS`, `AUTO_SPIN`), `bands.js` (`layer` của từng dải,
`bandAt(r, layerId)`), `textures/drawLayers.js` (`strokesL1` tách ba),
`scene/particles.js` (số vành thành `LAYER_COUNT` thay cho 4 ghi cứng),
`scene/layers.js` (`visibleMask`), `scene/picking.js` (lề 0.03 chỉ cho vành
ngoài cùng). Mọi chỗ sửa đều có ghi chú `KiNg:` hoặc giải thích tại chỗ.

Bảng đọc số (ngày, kinh độ Mặt Trời, tên tiết khí, pha trăng) thì KHÔNG được
port — nó nằm trong `ui/app.js`. Trên trang chủ lớp lịch chỉ là hình.

## Đồng bộ lại từ project gốc

Copy lại đúng các file `.js` hiện có trong thư mục này, rồi chạy
`npm run typecheck` và `npm run build`. **Chép đè là mất phần tách vành ở
trên** — phải làm lại các thay đổi trong mục "Vành lịch ngoài đã tách làm ba",
nếu không `index.ts` sẽ tìm `L1a`/`L1b` không thấy và cảnh không dựng được. Nếu project gốc thêm module mới mà
module đã port lại `import` tới, phải copy thêm module đó — các file ở đây
không import gì ngoài `three` và lẫn nhau.
