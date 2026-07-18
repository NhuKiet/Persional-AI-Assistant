import { lazy, Suspense } from "react";
import type { ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import "./styles.css";

import { TOOLS } from "./config/tools";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { HomePage } from "./pages/HomePage";
import { LandingPage } from "./pages/LandingPage";

/** Lazy: các trang nặng / ít vào đầu tiên được tách khỏi bundle chính, chỉ tải
 *  khi điều hướng tới. Quan trọng nhất là PDFPage — nó kéo theo react-pdf +
 *  pdfjs worker (~1.4MB) mà trước đây nạp ngay từ lần load đầu dù người dùng chỉ
 *  đứng ở landing. Landing + Home để eager vì là điểm vào chính, lazy sẽ gây
 *  nháy. Named export nên phải map .default cho React.lazy. */
const ResearchPage = lazy(() => import("./pages/ResearchPage").then(m => ({ default: m.ResearchPage })));
const CodingPage   = lazy(() => import("./pages/CodingPage").then(m => ({ default: m.CodingPage })));
const PDFPage      = lazy(() => import("./pages/PdfPage").then(m => ({ default: m.PDFPage })));
const ToolPage     = lazy(() => import("./pages/ToolPage").then(m => ({ default: m.ToolPage })));

/** Fallback trong lúc chunk route đang tải. Spinner tự chứa (dùng keyframe
 *  `spin` toàn cục + token màu) để không phụ thuộc CSS của trang chưa tải. */
function PageLoading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh" }}>
      <span style={{
        width: 22, height: 22, borderRadius: "50%", display: "inline-block",
        border: "2px solid var(--border2)", borderTopColor: "var(--accent)",
        animation: "spin 0.7s linear infinite",
      }} />
    </div>
  );
}

/** Bọc một route trong ErrorBoundary + Suspense riêng. Boundary Ở TỪNG route
 *  (không bọc chung cả <Routes>) để một page crash không kéo sập router; Suspense
 *  cho phép element lazy tải mà không chặn cả app. */
function guarded(element: ReactElement, label?: string): ReactElement {
  return (
    <ErrorBoundary label={label}>
      <Suspense fallback={<PageLoading />}>{element}</Suspense>
    </ErrorBoundary>
  );
}

function ToolRoute() {
  const { toolId } = useParams();
  const tool = TOOLS.find(t => t.id === toolId);
  // toolId không khớp tool nào: URL sai thật sự, về "/" như catch-all bên dưới.
  if (!tool) return <Navigate to="/" replace />;
  return <ToolPage tool={tool} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/"             element={guarded(<LandingPage />)} />
      <Route path="/chat"         element={guarded(<HomePage />, "Trò chuyện")} />
      <Route path="/research"     element={guarded(<ResearchPage />, "Research")} />
      <Route path="/coding"       element={guarded(<CodingPage />, "Coding")} />
      <Route path="/pdf"          element={guarded(<PDFPage />, "PDF Chat")} />
      <Route path="/tool/:toolId" element={guarded(<ToolRoute />)} />
      <Route path="*"             element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
