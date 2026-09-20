/** Icon của 6 tool — SVG nét đơn sắc vẽ bằng `currentColor`, KHÔNG phải emoji.
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
  /** id trong TOOLS (research | coding | homework | essay | email | pdf). */
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
