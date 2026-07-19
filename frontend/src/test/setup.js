import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Node 26 định nghĩa sẵn một localStorage experimental (cần --localstorage-file),
// và nó che mất bản của jsdom => window.localStorage undefined. App đọc
// localStorage khi render nên phải shim lại bằng một bản in-memory.
if (!window.localStorage) {
  const store = new Map();
  const localStorageShim = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => void store.set(String(k), String(v)),
    removeItem: (k) => void store.delete(String(k)),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, "localStorage", {
      value: localStorageShim, configurable: true, writable: true,
    });
  }
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// jsdom không implement scrollIntoView; các page tự cuộn xuống cuối khi có message.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom không có các API này; PdfViewer/SelectionLayer chạm tới chúng.
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
}
if (!global.ResizeObserver) {
  global.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}
if (!global.IntersectionObserver) {
  global.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() {} unobserve() {} disconnect() {}
  };
}

// Giả lập react-pdf để tránh crash trong môi trường jsdom (CI/GitHub Actions)
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
  Document: vi.fn(({ children }) => children),
  Page: vi.fn(() => null),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "" }));
