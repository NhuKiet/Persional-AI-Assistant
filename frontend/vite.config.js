import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Frontend gọi backend cùng origin ("/api/…", xem src/lib/api.ts) để cookie
    // đăng nhập đi kèm mọi request. Stream SSE đi qua proxy này nguyên vẹn.
    // KING_BACKEND: trỏ sang backend khác (vd. bản kiểm tra ở cổng khác).
    proxy: {
      "/api": process.env.KING_BACKEND ?? "http://127.0.0.1:8000",
      "/health": process.env.KING_BACKEND ?? "http://127.0.0.1:8000",
    },
  },
  test: {
    environment: "jsdom",
    // jsdom mặc định chạy ở about:blank => origin mờ => localStorage undefined.
    // App đọc localStorage ngay khi render, nên phải cho nó một origin thật.
    environmentOptions: { jsdom: { url: "http://localhost:5173" } },
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    // Một test luồng dài (render <App />, chờ lazy route, gửi, Reset…) có vài
    // lần chờ, mỗi lần tới asyncUtilTimeout (5s, xem setup.js) — 5s mặc định
    // cho cả test là quá sát khi cả bộ chạy song song.
    testTimeout: 15000,
    // beforeAll nạp chunk Markdown (react-markdown + KaTeX): lần chạy đầu sau
    // khi máy nghỉ lâu phải đọc cả nghìn file từ đĩa nguội, 10s mặc định có
    // lúc không đủ và cả file test bị tính là fail.
    hookTimeout: 30000,
    css: false,
  },
});
