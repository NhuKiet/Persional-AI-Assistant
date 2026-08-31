/** Màu accent thương hiệu, cho các chỗ JSX phải truyền màu xuống inline style.
 *
 *  Là chuỗi var(--accent), không phải hex tĩnh — --accent giờ khác nhau giữa
 *  theme tối/sáng (xem base.css), một hằng hex ở đây sẽ lệch theme ngay khi
 *  đổi. Mọi nơi tiêu thụ ACCENT từng nối chuỗi alpha kiểu `accentColor + "22"`
 *  đã được đổi sang `color-mix(in srgb, accentColor N%, transparent)` (var()
 *  không ghép hậu tố hex được) — xem Message.tsx, Sidebar.tsx. Thêm nơi dùng
 *  mới thì theo đúng pattern color-mix() đó, đừng quay lại ghép chuỗi hex.
 */
export const ACCENT = "var(--accent)";
