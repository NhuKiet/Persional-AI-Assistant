/** Màu accent thương hiệu, cho các chỗ JSX phải truyền hex xuống inline style.
 *
 *  Phải giữ đồng bộ thủ công với --accent trong styles/base.css. Lý do không
 *  dùng thẳng "var(--accent)": vài component nối chuỗi alpha vào (accentColor +
 *  "22"), và "var(--accent)22" không phải màu hợp lệ. Chỗ nào CSS tự lo được
 *  thì dùng var(--accent) trong stylesheet, đừng truyền hằng này xuống.
 */
export const ACCENT = "#1ed1c2";
