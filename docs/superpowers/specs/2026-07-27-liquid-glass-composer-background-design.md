# Liquid Glass Composer và nền pastel Light theme — Design

**Ngày:** 2026-07-27  
**Phạm vi:** Frontend. Áp dụng cho toàn bộ chat composer và nền canvas của Light theme.

## Mục tiêu

1. Đưa toàn bộ chat bar trong ứng dụng về cùng một vật liệu “liquid glass” có chiều sâu, trong mờ và bắt sáng giống ảnh tham chiếu.
2. Thêm nền trắng ngọc trai với các quầng pastel xanh lam, vàng-xanh và đào rất nhẹ cho Light theme.
3. Đặt Light theme làm mặc định cho người dùng chưa từng chọn theme.
4. Giữ nguyên Dark theme hiện tại và không thay đổi hành vi nhập, gửi, dừng, mic, đính kèm hay chọn model.

## Phạm vi giao diện

Thiết kế áp dụng cho:

- `InputBar` dùng tại Home, Research, các tool và các luồng follow-up.
- Composer dựng trực tiếp bằng class dùng chung tại Coding và PDF assistant.
- Trạng thái thường, hover, focus, disabled và streaming.
- Light theme trên toàn bộ canvas ứng dụng.

Không thay đổi message bubble, markdown, kết quả research, code block, PDF viewer hoặc cấu trúc điều hướng.

## Hướng thị giác đã duyệt

### Liquid glass cân bằng

Chat bar là một capsule trong mờ, không phải một khối trắng đặc:

- Lớp kính chính dùng gradient alpha thấp để tạo độ dày.
- Viền ngoài sáng mảnh, rõ hơn ở cạnh trên.
- Một highlight mềm nằm trong nửa trên của capsule để gợi phản xạ cong.
- Bóng dưới rộng nhưng nhẹ để tách kính khỏi nền mà không tạo cảm giác nổi cứng.
- Khi focus, viền và quầng sáng nhận tint từ accent hiện hành; không scale hoặc làm xê dịch layout.
- Nút đính kèm, mic, model picker và nút gửi dùng cùng ngôn ngữ vật liệu. Nút gửi giữ accent mạnh hơn để bảo toàn thứ bậc hành động.

Thiết kế phải giữ độ tương phản văn bản đạt WCAG AA trong cả hai theme.

### Nền Light theme

Nền sáng dùng một hệ gradient CSS, không dùng ảnh bitmap:

- Base trắng ngọc trai gần trung tính.
- Quầng xanh lam nhạt ở vùng giữa-trái.
- Quầng vàng-xanh nhạt ở vùng dưới-phải.
- Một quầng đào rất nhẹ có thể xuất hiện ở góc trên-phải.
- Chuyển màu rộng, mờ và không có biên nhìn thấy.
- Film grain hiện có chỉ được giữ ở mức rất thấp; nền không được trông bẩn hoặc nhiễu.

Các quầng là không khí nền, không mang thông tin và không được làm giảm khả năng đọc. Dark theme tiếp tục dùng canvas tối hiện tại.

## Kiến trúc CSS

Tuân theo cascade và quyền sở hữu file hiện tại:

- `frontend/src/styles/base.css`
  - Bổ sung token cần thiết cho kính và nền pastel trong `:root[data-theme="light"]`.
  - Định nghĩa nền canvas Light theme bằng token hoặc pseudo-element nền dùng chung.
  - Không đổi thứ tự import.
- `frontend/src/styles/chat.css`
  - Restyle `.input-bar`, `.input-attach`, `.mic-btn`, `.input-send` và phần liên quan của model picker.
  - Dùng pseudo-element của `.input-bar` cho highlight phản xạ; nội dung tương tác nằm trên highlight bằng stacking rõ ràng.
- `frontend/src/styles/responsive.css`
  - Chỉ thêm override nếu capsule hoặc cụm action không vừa ở breakpoint hiện có.

Không thêm stylesheet mới. Không dùng `!important`. Giá trị dùng lặp lại phải trở thành token trong `base.css`.

## Theme mặc định và persistence

`useTheme` tiếp tục ưu tiên preference hợp lệ đã lưu trong `localStorage["king-theme"]`. Nếu chưa có preference:

- Khởi tạo bằng `"light"` bất kể `prefers-color-scheme` của hệ điều hành.
- Ghi `data-theme="light"` trước khi React render để tránh flash Dark theme.
- Sau khi người dùng tự chuyển sang Dark hoặc Light, lựa chọn đã lưu luôn thắng mặc định.

Script chống FOUC trong entry HTML và `initialTheme()` phải dùng cùng một thứ tự ưu tiên.

## Hành vi và khả năng truy cập

- Không thay đổi DOM contract hoặc callback của `InputBar`.
- Enter gửi, Shift+Enter xuống dòng, streaming dừng, mic và upload giữ nguyên.
- Focus ring/tint phải nhìn thấy rõ bằng bàn phím.
- Trạng thái disabled không chỉ dựa vào màu.
- `prefers-reduced-motion` tiếp tục vô hiệu hóa chuyển động không cần thiết.
- Hiệu ứng chỉ animate màu, opacity và shadow; không animate blur liên tục hoặc chạy ambient animation.
- Trình duyệt không hỗ trợ `backdrop-filter` vẫn thấy một bề mặt đủ đục và có độ tương phản tốt.

## Responsive

- Capsule giữ dạng pill ở Home và các trang tool.
- Trên panel hẹp như PDF, khoảng cách và control size có thể giảm theo breakpoint nhưng vẫn dùng cùng vật liệu.
- Model picker được phép co hoặc ẩn phần text theo quy tắc hiện tại; textarea không được bị ép dưới kích thước sử dụng được.
- Không tạo horizontal overflow ở chiều rộng 320px.

## Kiểm thử và xác minh

### Automated

- Cập nhật test `useTheme` để xác nhận người dùng mới nhận Light theme mặc định.
- Giữ test persistence: preference Dark/Light đã lưu phải được đọc lại.
- Giữ test hành vi `InputBar` cho gửi, đính kèm và streaming.
- Chạy test frontend, typecheck và build.

### Visual

Kiểm tra runtime trên:

- Home ở trạng thái thường và focus.
- Một trang tool dùng accent khác teal.
- Research composer.
- Coding composer.
- PDF assistant ở panel hẹp.
- Light và Dark theme.
- Desktop và mobile breakpoint.

Tiêu chí đạt:

- Light theme mở mặc định khi chưa có preference.
- Nền Light theme giống tinh thần ảnh tham chiếu: trắng ngọc trai, quầng pastel rộng và rất mềm.
- Mọi chat bar đọc như cùng một hệ liquid glass.
- Dark theme không bị thay đổi ngoài việc nhận cấu trúc kính dùng chung phù hợp với token tối.
- Không có clipping, dropdown bị che, lỗi stacking hoặc giảm khả năng đọc.
