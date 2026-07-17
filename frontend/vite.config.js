import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    // jsdom mặc định chạy ở about:blank => origin mờ => localStorage undefined.
    // App đọc localStorage ngay khi render, nên phải cho nó một origin thật.
    environmentOptions: { jsdom: { url: "http://localhost:5173" } },
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    css: false,
  },
});
