# blackhole/ — nền "hố đen + sao"

Các file `.js` trong thư mục này là mã **vendor** lấy từ project độc lập
`ho-den` (Vite + three.js thuần), giữ dạng `.js` có chủ ý — cùng lý do với
[../compass/](../compass/README.md): `tsconfig.json` để `allowJs: true,
checkJs: false`, và mục tiêu là đồng bộ lại từ project gốc dễ nhất có thể.

| File | So với bản gốc |
|---|---|
| `layers/blackhole.js` | **Nguyên trạng** (`src/layers/blackhole.js`). Đồng bộ lại = chép đè. |
| `layers/stars.js` | Bỏ thấu kính con trỏ và phần mờ dưới tấm công thức; vùng rải sao rộng hơn. |
| `glsl/common.js` | Bỏ bảng mép quạt `FAN_EDGES` và hàm `lensed()`. |
| `config.js` | Chỉ trích `BH`, `LUT_*`, `STARS` và các hằng khung tham chiếu. |

Phần **có kiểu** là ranh giới duy nhất mà app chạm vào: [index.ts](index.ts),
xuất `createBlackHoleBackdrop(canvas)` trả về `BlackHoleHandle`. Thành phần
React dùng nó là `components/BlackHoleBackdrop.tsx`.

## Những gì KHÔNG được port

Tấm công thức (`sheet.js`, `funnel.js`, `atlas.js`, `drops.js`, MathJax), bảng
điều khiển, tương tác chuột (`interact.js`), lớp phủ debug và chuỗi hậu kỳ
(`post.js`: UnrealBloomPass + grain + vignette). Project gốc mặc định cũng chỉ
hiện hố đen + sao; bloom chung gần như không chạm lớp hố đen (nó có quầng và
bloom riêng trong `blackhole.js`), nên bỏ đi chỉ mất chút quầng quanh sao.
