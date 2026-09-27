/** Icon của các tool — SVG nét đơn sắc vẽ bằng `currentColor`, KHÔNG phải emoji.
 *
 *  Lý do: emoji (💻📘✍️📧) là ảnh màu đầy đủ bão hòa do hệ điều hành vẽ, nằm
 *  ngoài bảng màu đất trầm của app (xem hệ --accent-* trong base.css) nên dock
 *  nhìn như chưa hoàn thiện; màu lại đổi theo font hệ thống của từng máy.
 *  Dùng `currentColor` để nơi tiêu thụ chỉ cần set `color` (thường là
 *  var(--accent-<tool>)) là icon ăn theo, kể cả khi đổi theme.
 *
 *  Tất cả vẽ trong khung 24x24, stroke 1.6 — cùng ngôn ngữ nét với icon nav /
 *  theme toggle đã có sẵn ở LandingPage. */

import type { ReactElement } from "react";

interface ToolIconProps {
  /** id trong TOOLS (research | coding | homework | essay | email | pdf | hmer),
   *  hoặc "news" cho lối tắt trang chủ.
   *  Id không có hình thì không vẽ gì — thêm tool mới vào TOOLS thì phải thêm
   *  hình vào PATHS, nếu không nút của nó ở dock sẽ là một ô trống. */
  tool: string;
  size?: number;
}

const PATHS: Record<string, ReactElement> = {
  research: (
    <>
      <circle cx="11" cy="11" r="6.25" />
      <path d="M15.6 15.6 20 20" strokeLinecap="round" />
    </>
  ),
  coding: (
    <>
      <path d="m9 9-3.2 3.2L9 15.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m15 9 3.2 3.2L15 15.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.2 6.4 10.8 18" strokeLinecap="round" />
    </>
  ),
  homework: (
    <>
      <path d="M5 4.8h9.4a3 3 0 0 1 3 3v11.4H8a3 3 0 0 1-3-3V4.8Z" strokeLinejoin="round" />
      <path d="M8 19.2a3 3 0 0 1 3-3h6.4" strokeLinejoin="round" />
      <path d="M8.6 8.6h5.6" strokeLinecap="round" />
    </>
  ),
  essay: (
    <>
      <path d="M17.3 4.9 19.1 6.7a1.4 1.4 0 0 1 0 2L9.7 18.1l-3.6.9.9-3.6 9.4-9.4a1.4 1.4 0 0 1 2-.1Z" strokeLinejoin="round" />
      <path d="m14.8 7.4 1.8 1.8" strokeLinecap="round" />
    </>
  ),
  email: (
    <>
      <rect x="3.5" y="5.8" width="17" height="12.4" rx="2.2" />
      <path d="m4.4 7.4 6.4 4.6a2 2 0 0 0 2.4 0l6.4-4.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  pdf: (
    <>
      <path d="M13.4 3.8H7.6a2 2 0 0 0-2 2v12.4a2 2 0 0 0 2 2h8.8a2 2 0 0 0 2-2V8.8Z" strokeLinejoin="round" />
      <path d="M13.4 3.8v3.2a1.8 1.8 0 0 0 1.8 1.8h3.2" strokeLinejoin="round" />
      <path d="M9 13.4h6M9 16.4h4" strokeLinecap="round" />
    </>
  ),
  /* Công thức viết tay: dấu căn √ đọc ra ngay là "toán", còn chữ x bên dưới
     vẽ bằng hai nét cong có móc ở đầu — dáng chữ viết tay, không phải chữ in —
     để nói phần "viết tay". Hai nét x cắt nhau ở giữa khoảng trống dưới gạch
     ngang của dấu căn cho cân. */
  hmer: (
    <>
      <path d="M3.4 12.9 5.6 11.7 8.8 19 12.2 5h8.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.3 9.6c.9-.3 1.7.2 2.2 1.3l1.6 3.4c.5 1.1 1.3 1.6 2.3 1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.2 9.7c-.9.1-1.6.7-2.3 1.9l-1.8 3.2c-.6 1-1.3 1.4-2.1 1.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  /* Tin AI (không nằm trong TOOLS — trang /news riêng, dùng ở lối tắt trang
     chủ): tờ báo gập, ô ảnh bên trái và các dòng chữ. */
  news: (
    <>
      <path d="M5.2 5.4h11.4v11.8a2 2 0 0 0 2 2H7.2a2 2 0 0 1-2-2V5.4Z" strokeLinejoin="round" />
      <path d="M16.6 9.2h2.2v8a2 2 0 0 1-2 2" strokeLinejoin="round" />
      <rect x="8" y="8.2" width="3.8" height="3.4" rx=".6" />
      <path d="M13.8 8.8h.4M13.8 11h.4M8 14.6h5.8" strokeLinecap="round" />
    </>
  ),
};

export function ToolIcon({ tool, size = 20 }: ToolIconProps) {
  const path = PATHS[tool];
  if (!path) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.6"
      aria-hidden="true" focusable="false"
    >
      {path}
    </svg>
  );
}
