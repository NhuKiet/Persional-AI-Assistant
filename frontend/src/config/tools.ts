/** Danh sách tool + gợi ý prompt + nhãn nguồn cho Research. */

export interface Tool {
  id: string;
  label: string;
  icon: string;
  color: string;
  desc: string;
}

/* `color` là chuỗi var(--accent-*), KHÔNG phải hex tĩnh — vì bảng màu tool
 * giờ khác nhau giữa theme tối/sáng (xem base.css). Dùng var() để nơi tiêu
 * thụ (ToolDock, ToolPage, ...) tự đổi theo theme qua CSS cascade, khỏi cần
 * biết theme hiện tại đang là gì. Hệ quả: mọi nơi ghép chuỗi kiểu
 * `tool.color + "44"` để ra alpha-hex sẽ HỎNG (var() không ghép hậu tố hex
 * được) — phải dùng `color-mix(in srgb, ${tool.color} N%, transparent)`. */
export const TOOLS: Tool[] = [
  { id: "research", label: "Research",  icon: "🔍", color: "var(--accent-research)", desc: "Deep research từ Arxiv, HuggingFace, Stack Overflow & Web" },
  { id: "coding",   label: "Coding",    icon: "💻", color: "var(--accent-coding)",   desc: "AI coding agent: plan → code → execute → debug" },
  { id: "homework", label: "Bài tập",   icon: "📘", color: "var(--accent-homework)", desc: "Giải toán, lý, hóa, lập trình" },
  { id: "essay",    label: "Nghị luận", icon: "✍️", color: "var(--accent-essay)",    desc: "Viết văn nghị luận, luận điểm" },
  { id: "email",    label: "Email",     icon: "📧", color: "var(--accent-email)",    desc: "Soạn thảo, phân loại email" },
  { id: "pdf",      label: "PDF Chat",  icon: "📄", color: "var(--accent-pdf)",      desc: "Chat với tài liệu PDF — tóm tắt, hỏi đáp" },
];

/** Tool nào có page riêng thì đi thẳng route đó; còn lại dùng /tool/:id chung.
 *  Dùng chung ở cả LandingPage (thẻ công cụ) và HomePage (dock 6 tool) —
 *  đừng để hai nơi tự định nghĩa DEDICATED_ROUTES riêng, dễ trôi. */
const DEDICATED_ROUTES: Record<string, string> = { research: "/research", coding: "/coding", pdf: "/pdf" };
export const toolPath = (tool: Tool) => DEDICATED_ROUTES[tool.id] ?? `/tool/${tool.id}`;

export const SUGGESTIONS: Record<string, string[]> = {
  home:     ["Giải thích transformer architecture", "Viết email xin việc chuyên nghiệp", "Tóm tắt: Trí tuệ nhân tạo là gì?", "Giải bài toán xác suất cơ bản"],
  research: ["Latest advances in diffusion models", "Compare RLHF vs DPO training methods", "Explain RAG architecture in LLMs", "State of the art in protein folding"],
  coding:   ["Viết script đọc CSV và vẽ biểu đồ", "Tạo web scraper lấy giá sản phẩm", "Thuật toán sắp xếp nhanh quicksort", "Parse JSON API và lưu vào SQLite"],
  homework: ["Giải phương trình bậc 2: x²+5x+6=0", "Viết hàm tính fibonacci bằng Python", "Giải thích định lý Pytago"],
  essay:    ["Nghị luận về vai trò của AI trong giáo dục", "Mạng xã hội có hại hay có lợi?"],
  email:    ["Soạn email xin nghỉ phép 3 ngày", "Viết email follow-up sau phỏng vấn"],
  pdf:      ["Tóm tắt tài liệu này cho tôi", "Các điểm chính trong tài liệu là gì?", "Giải thích phần ... trong tài liệu", "So sánh các khái niệm được đề cập"],
};

/** Fisher-Yates — không mutate mảng gốc, gọi lại cho thứ tự khác mỗi lần. */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface SourceLabel {
  label: string;
  icon: string;
}

export const SOURCE_LABELS: Record<string, SourceLabel> = {
  web:           { label: "Web",              icon: "🌐" },
  arxiv:         { label: "Arxiv",            icon: "📄" },
  huggingface:   { label: "HuggingFace",      icon: "🤗" },
  semantic:      { label: "Semantic Scholar", icon: "🔬" },
  duckduckgo:    { label: "DuckDuckGo",       icon: "🦆" },
  stackoverflow: { label: "Stack Overflow",   icon: "💬" },
  llm:           { label: "Synthesizing",     icon: "◆" },
};
