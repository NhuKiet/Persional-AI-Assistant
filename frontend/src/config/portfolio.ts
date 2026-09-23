/** Nội dung portfolio hiển thị trong quyển sách lật ở trang chủ.
 *
 *  Tách khỏi component để sửa nội dung không phải đụng vào logic lật trang —
 *  thêm một trang = thêm một phần tử vào PORTFOLIO_PAGES, không sửa gì khác.
 *
 *  Song ngữ: mọi chuỗi người dùng đọc được đều là `Bi` (vi + en). Không dùng
 *  hệ i18n nào vì cả app chỉ có đúng chỗ này cần hai thứ tiếng — kéo về một
 *  thư viện i18n cho một component là cái giá không đáng.
 *
 *  CHỦ Ý không đưa số điện thoại, ngày sinh và địa chỉ trong CV lên đây: trang
 *  chủ là trang công khai, bot quét được. Chỉ email + GitHub, đủ để liên hệ
 *  công việc.
 */

export type Lang = "vi" | "en";

/** Một chuỗi ở cả hai thứ tiếng. */
export type Bi = Record<Lang, string>;
/** Một danh sách gạch đầu dòng ở cả hai thứ tiếng. */
export type BiList = Record<Lang, string[]>;

export interface PortfolioLink {
  label: string;
  href: string;
}

export interface PortfolioPage {
  id: string;
  /** Nhãn ngắn cho chỉ mục/aria — không phải tiêu đề đầy đủ. */
  tab: Bi;
  title: Bi;
  /** Dòng phụ dưới tiêu đề: vai trò · thời gian. */
  meta?: Bi;
  /** Đoạn mở đầu, dùng cho trang giới thiệu. */
  body?: Bi;
  bullets?: BiList;
  links?: PortfolioLink[];
}

export const PORTFOLIO_PAGES: PortfolioPage[] = [
  {
    id: "about",
    tab: { vi: "Giới thiệu", en: "About" },
    title: { vi: "Bùi Như Kiệt", en: "Bui Nhu Kiet" },
    meta: { vi: "Kỹ sư AI", en: "AI Engineer" },
    body: {
      vi: "Kỹ sư AI, tốt nghiệp ngành Trí tuệ nhân tạo tại Đại học FPT. Làm việc với machine learning, computer vision và data science; đã đưa mô hình AI từ nghiên cứu ra sản phẩm chạy thật qua các dự án và kỳ thực tập.",
      en: "AI Engineer, recent AI graduate from FPT University with skills in machine learning, computer vision and data science. Experienced in developing and deploying AI models through projects and internships, and eager to apply that knowledge to real-world solutions.",
    },
  },
  {
    id: "skills",
    tab: { vi: "Kỹ năng", en: "Skills" },
    title: { vi: "Kỹ năng", en: "Skills" },
    bullets: {
      vi: [
        "Ngôn ngữ: Python, JavaScript",
        "AI & ML: PyTorch, TensorFlow, Keras, OpenCV, Scikit-learn, LLM & RAG (OpenAI, Gemini, Weaviate)",
        "Backend & DevOps: FastAPI, Next.js / React, Docker, PostgreSQL, Git",
        "Ngoại ngữ: Tiếng Anh",
      ],
      en: [
        "Programming: Python, JavaScript",
        "AI & ML: PyTorch, TensorFlow, Keras, OpenCV, Scikit-learn, LLM & RAG (OpenAI, Gemini, Weaviate)",
        "Backend & DevOps: FastAPI, Next.js / React, Docker, PostgreSQL, Git",
        "Languages: English",
      ],
    },
  },
  {
    id: "vinuni",
    tab: { vi: "VinUniversity", en: "VinUniversity" },
    title: {
      vi: "VinUniversity — Nền tảng giáo dục kỹ năng sống bằng AI (B2B)",
      en: "VinUniversity — AI Life-Skills Education Platform (B2B)",
    },
    meta: { vi: "Kỹ sư AI · 2026 – nay", en: "AI Engineer · 2026 – Present" },
    bullets: {
      vi: [
        "Xây web app AI full-stack (Next.js 16 + FastAPI): giáo viên tạo kịch bản tương tác, học sinh trò chuyện với một AI companion; tích hợp song song hai nhà cung cấp LLM (OpenAI / Gemini) qua pipeline RAG trên Weaviate.",
        "Thiết kế kiểm duyệt nội dung hai lớp + cờ an toàn từ LLM (chặn 100%, 0% báo nhầm), gia cố chống prompt injection; bảo vệ API bằng JWT/OAuth2 và phân quyền theo vai trò.",
        "Quản lý schema PostgreSQL bằng Alembic, đóng gói Docker, triển khai lên Railway; viết ~200 test pytest.",
        "Dựng dashboard tổng hợp cho giáo viên với tóm tắt ẩn danh và cảnh báo an toàn; benchmark độ trễ và chi phí token giữa các nhà cung cấp để giảm thời gian phản hồi và tiền API.",
      ],
      en: [
        "Built a full-stack AI web app (Next.js 16 + FastAPI) where teachers generate interactive scenarios and students chat with an AI companion; integrated dual LLM providers (OpenAI / Gemini) with a Weaviate RAG pipeline.",
        "Designed two-layer content moderation + LLM safety flags (100% block-rate / 0% false-positive) with prompt-injection hardening; secured APIs with JWT/OAuth2 and role-based access control.",
        "Managed the PostgreSQL schema via Alembic, containerized with Docker, deployed to Railway; wrote ~200 pytest tests.",
        "Built an AI-aggregated teacher dashboard with anonymized student summaries and safety alerts; benchmarked latency and token cost across providers to cut response time and API spend.",
      ],
    },
  },
  {
    id: "king",
    tab: { vi: "KiNg", en: "KiNg" },
    title: {
      vi: "KiNg — Trợ lý AI cá nhân (dự án cá nhân)",
      en: "KiNg — Personal AI Research Assistant (personal project)",
    },
    meta: { vi: "Kỹ sư AI · 12/2025 – 6/2026", en: "AI Engineer · Dec 2025 – Jun 2026" },
    bullets: {
      vi: [
        "Chính là trang bạn đang xem: trợ lý AI full-stack (FastAPI + React/Vite, stream qua SSE) gộp bốn công cụ — Chat, Deep Research, Coding Agent và PDF Chat — chạy LLM (Llama 3) hoàn toàn local qua Ollama.",
        "Thiết kế pipeline RAG hybrid-search kết hợp vector dense + sparse BGE-M3, thêm reranker BGE và chấm độ tin cậy; tái dùng tri thức đã thu thập giúp giảm thời gian trả lời từ ~19s xuống ~0.4s với truy vấn đã cache.",
        "Viết research agent truy vấn 7 nguồn song song qua ThreadPoolExecutor, tự chunk và lưu kết quả vào vector DB, rồi tổng hợp thành tóm tắt, điểm chính, bảng so sánh và biểu đồ.",
      ],
      en: [
        "The page you are looking at: a full-stack AI assistant (FastAPI + React/Vite with SSE streaming) integrating four tools — Chat, Deep Research, Coding Agent and PDF Chat — running an LLM (Llama 3) fully locally via Ollama.",
        "Designed a hybrid-search RAG pipeline combining BGE-M3 dense + sparse vectors, with a BGE reranker and credibility scoring, enabling knowledge reuse that cut response time from ~19s to ~0.4s on cached queries.",
        "Developed a research agent that queries 7 sources in parallel via ThreadPoolExecutor, auto-chunks and persists results to the vector DB, then synthesizes summaries, key points, comparison tables and charts.",
      ],
    },
  },
  {
    id: "capstone",
    tab: { vi: "Capstone", en: "Capstone" },
    title: {
      vi: "Đại học FPT — Capstone: Nhận dạng công thức toán viết tay",
      en: "FPT University — Capstone: Handwritten Mathematical Expression Recognition",
    },
    meta: {
      vi: "Quản lý dự án & Kỹ sư AI · 1/2025 – 6/2025",
      en: "Project Manager & AI Engineer · Jan 2025 – Jun 2025",
    },
    bullets: {
      vi: [
        "Dẫn dắt nhóm: phân công công việc, lên lịch, kiểm thử và đánh giá triển khai.",
        "Nghiên cứu và benchmark các mô hình SOTA (BTTR, CoMER, PosFormer) trên bộ dữ liệu CROHME và HME100K.",
        "Thiết kế kiến trúc lai dùng Swin Transformer làm encoder và Transformer truyền thống làm decoder; áp dụng augmentation (xoay, co giãn, thêm nhiễu) khi huấn luyện.",
        "Cài đặt các chỉ số đánh giá (ExpRate, tỉ lệ lỗi ≤1/2/3) và tối ưu hiệu năng mô hình.",
      ],
      en: [
        "Led team management: task assignment, scheduling, testing and deployment evaluation.",
        "Researched and benchmarked state-of-the-art models (BTTR, CoMER, PosFormer) on the CROHME and HME100K datasets.",
        "Designed a hybrid architecture using Swin Transformer as encoder and a traditional Transformer as decoder, with augmentation (rotation, scaling, noise injection) during training.",
        "Implemented evaluation metrics (ExpRate, ≤1/2/3 error rates) and optimized model performance.",
      ],
    },
    links: [
      { label: "GitHub", href: "https://github.com/SP25AI12/CapstoneProject_SP25AI12" },
    ],
  },
  {
    id: "pengi",
    tab: { vi: "Pengi", en: "Pengi" },
    title: {
      vi: "QAI – FPT Software Quy Nhơn — Pengi Chatbot",
      en: "QAI – FPT Software Quy Nhon — Pengi Chatbot",
    },
    meta: {
      vi: "Quản lý dự án & Kỹ sư AI · 1/2024 – 5/2024",
      en: "Project Manager & AI Engineer · Jan 2024 – May 2024",
    },
    bullets: {
      vi: [
        "Phát triển chatbot FAQ dựa trên RAG cho Đại học FPT, tập trung vào tuyển sinh và thông tin học vụ.",
        "Thiết kế pipeline dữ liệu hợp nhất giữa FAQ có cấu trúc và nguồn tri thức dạng tài liệu.",
        "Tiền xử lý văn bản cho dữ liệu tài liệu, tích hợp Qdrant và sinh câu trả lời tinh chỉnh với mô hình Llama3-ViettelSolutions-8B của Viettel Solutions.",
      ],
      en: [
        "Developed a RAG-based FAQ chatbot for FPT University, focusing on admission and academic information.",
        "Designed a unified data pipeline integrating structured FAQs and document-based knowledge sources.",
        "Applied text preprocessing for document data, integrated Qdrant and fine-tuned response generation with Viettel Solutions' Llama3-ViettelSolutions-8B model.",
      ],
    },
  },
  {
    id: "education",
    tab: { vi: "Học vấn", en: "Education" },
    title: { vi: "Học vấn & chứng chỉ", en: "Education & certificates" },
    bullets: {
      vi: [
        "Đại học FPT — Cử nhân Trí tuệ nhân tạo · 2021 – 2025 · GPA 3.16/4",
        "VinUniversity — Chứng chỉ AI thực chiến",
      ],
      en: [
        "FPT University — B.Sc. in Artificial Intelligence · 2021 – 2025 · GPA 3.16/4",
        "VinUniversity — Practical AI certificate",
      ],
    },
  },
  {
    id: "contact",
    tab: { vi: "Liên hệ", en: "Contact" },
    title: { vi: "Liên hệ", en: "Get in touch" },
    body: {
      vi: "Mở cho cơ hội kỹ sư AI — LLM, RAG, computer vision, hoặc đưa mô hình ra sản phẩm chạy thật.",
      en: "Open to AI engineering roles — LLM, RAG, computer vision, or taking models from research into production.",
    },
    links: [
      { label: "buinhukiet03@gmail.com", href: "mailto:buinhukiet03@gmail.com" },
      { label: "github.com/NhuKiet", href: "https://github.com/NhuKiet" },
    ],
  },
];

/** Vài dòng giới thiệu năng lực cốt lõi, đứng NGAY TRÊN quyển sách. Ngắn có
 *  chủ đích: phần này để người đọc lướt trong hai giây rồi quyết định có mở
 *  sách ra đọc kỹ không. */
export const CORE_FEATURES: { k: Bi; v: Bi }[] = [
  {
    k: { vi: "Nghiên cứu", en: "Research" },
    v: { vi: "7 nguồn song song, tổng hợp có trích dẫn", en: "7 sources in parallel, cited synthesis" },
  },
  {
    k: { vi: "Lập trình", en: "Coding" },
    v: { vi: "Lên kế hoạch → viết → chạy thử → tự sửa", en: "Plan → code → execute → self-debug" },
  },
  {
    k: { vi: "Tài liệu", en: "Documents" },
    v: { vi: "Hỏi đáp trực tiếp trên PDF, ghim ngữ cảnh", en: "Chat over PDFs, pin context" },
  },
];
