/** Cờ bật/tắt các trang ở cấp toàn app.
 *
 *  Chỉ điều khiển LỐI VÀO trong giao diện (link sidebar, nav), KHÔNG tắt
 *  tính năng: route vẫn sống, page vẫn render, API vẫn chạy — vào thẳng URL
 *  là dùng được. Đây là chỗ để tạm giấu một trang chưa muốn khoe, không phải
 *  cơ chế phân quyền.
 *
 *  Cùng tinh thần với cờ `hidden` của từng tool trong config/tools.ts: bật lại
 *  = đổi đúng một giá trị ở đây, không phải lần theo từng component.
 */
export const FEATURES = {
  /** Trang điểm tin AI (`/news`) — tạm ẩn khỏi sidebar. */
  news: false,
} as const;
