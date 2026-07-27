# KiNg — Personal AI Assistant

<p align="center">
  <img src="frontend/src/assets/mainlogo.png" alt="KiNg logo" width="120" />
</p>

KiNg là hệ thống trợ lý AI cá nhân cao cấp chạy trên trình duyệt web, kết hợp giữa trò chuyện đa dạng ngữ cảnh, nghiên cứu chuyên sâu đa nguồn (Deep Research), sinh và thực thi mã Python tự động trong sandbox, cùng trợ lý phân tích tài liệu PDF thông minh. Ứng dụng hỗ trợ cả LLM local chạy qua Ollama và các API provider hàng đầu như Anthropic Claude hoặc OpenAI.

> Dự án hiện hướng tới môi trường cá nhân hoặc phát triển nội bộ. API chưa tích hợp lớp authentication hay rate-limiting đa người dùng; không nên public trực tiếp lên Internet nếu chưa bổ sung các lớp bảo vệ phù hợp.

---

## 🌟 Tính năng nổi bật

### 1. Giao diện Pearl Aurora Canvas & Liquid Glass
- **Hệ thống thiết kế Pearl Aurora**: Tone màu pastel ngọc trai sang trọng, chuyển đổi linh hoạt giữa giao diện Light (mặc định) và Dark mode.
- **Thành phần Liquid Glass Composer**: Thanh nhập liệu bo tròn hiệu ứng thủy tinh mờ (glassmorphism), với viền vi mô (micro-border), vùng phản chiếu ánh sáng tự nhiên và nút gửi dạng hạt ngọc động (liquid bead button).
- **Phản hồi linh hoạt**: Đáp ứng liền mạch từ màn hình Desktop siêu rộng, Laptop cho đến thiết bị di động Narrow/Mobile.

### 2. Trợ lý Trò chuyện & Chế độ Chuyên biệt (`/chat`, `/tool/*`)
- Stream phản hồi theo thời gian thực sử dụng **Server-Sent Events (SSE)**.
- Đổi model và provider linh hoạt ngay trên thanh điều khiển (Model Picker hỗ trợ Ollama, Anthropic Claude, OpenAI / OpenAI-compatible).
- **Chế độ chuyên biệt**: Gia sư bài tập (`/tool/homework`), Trợ lý viết văn nghị luận (`/tool/essay`), và Soạn thảo email chuyên nghiệp (`/tool/email`) với System Prompt tối ưu hóa cho từng mục đích.
- Quản lý lịch sử hội thoại backend trên **Supabase (Postgres)** với cơ chế tự dọn dẹp các phiên làm việc cũ.

### 3. Deep Research Agent (`/research`)
- **Tìm kiếm song song 7 nguồn**: Tavily Web Search, DuckDuckGo, arXiv (khoa học), Semantic Scholar, Hugging Face Papers, Stack Overflow và bước Tổng hợp (Synthesizing).
- **Cổng đánh giá kiến thức 3 tầng (Knowledge Gate)**: Phân loại mức độ đầy đủ của tri thức thành `EMPTY`, `STALE`, `THIN`, hoặc `MAYBE` trước khi quyết định tìm kiếm thêm hay trả lời trực tiếp.
- **Rerank & Deduplicate**: Sử dụng model rerank local `BAAI/bge-reranker-v2-m3` (hoặc adapter Cohere) để lọc trùng lập và sắp xếp kết quả theo độ tin cậy.
- **Deep Dive & Suggesstions**: Cho phép hỏi sâu từng nguồn cụ thể và đề xuất câu hỏi tiếp theo dựa trên bối cảnh.
- **Knowledge Store (Tùy chọn)**: Lưu trữ và truy vấn hybrid vector search trên **Weaviate Cloud** kết hợp OpenAI Embeddings.

### 4. Coding Agent Sandbox (`/coding`)
- **Vòng lặp tự động `Plan → Code → Execute → Debug`**: Sinh kế hoạch, tạo code Python multi-file, thực thi và tự động sửa lỗi lên đến `MAX_DEBUG_ITER` vòng.
- **Quản lý Tập tin & Artifacts**: Hỗ trợ tải lên file CSV, JSON, JSONL, Excel, Parquet, TXT, TSV, XML để làm phân tích dữ liệu và thu thập kết quả đồ họa (PNG, JPG, SVG, HTML) dạng Artifact.
- **Bảo mật tuyệt đối qua Docker Executor**: Thực thi code Python trong container Docker cô lập hoàn toàn (`--network none`, root filesystem read-only, rào cản CPU/RAM/PID).

### 5. Trợ lý Phân tích PDF (`/pdf`)
- **Môi trường làm việc chia đôi (Split-Screen Workspace)**: Tùy chỉnh tỷ lệ giữa tài liệu và bảng hỏi đáp, tương thích thông minh theo độ phân giải màn hình (Desktop split view, Laptop drawer, Narrow overlay).
- **Trích xuất & Tìm kiếm nội dung**: Đọc PDF bằng PyMuPDF, tìm kiếm từ khóa trực tiếp trên bản vẽ với highlight tự động qua PDF.js / react-pdf.
- **Khoanh vùng & Ghim ngữ cảnh (Pinning)**: Cho phép bôi đen đoạn văn bản hoặc khoanh vùng ảnh chụp trên tài liệu để dịch, giải thích hoặc thảo luận trực tiếp với model Vision.

---

## 🛠️ Công nghệ sử dụng

| Thành phần | Công nghệ / Thư viện |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, React Router v6, react-pdf, Lucide / Custom Icons |
| **Styling** | Vanilla CSS Design Tokens, Glassmorphism, Pearl Aurora Theme System |
| **Backend** | Python 3.11+, FastAPI, Uvicorn, Pydantic Settings, Asyncio |
| **Streaming** | Server-Sent Events (SSE) via `starlette.responses.StreamingResponse` |
| **Storage** | Supabase (Postgres) via `psycopg` connection pool, Browser `localStorage` |
| **LLM & Agent Framework** | LangChain, LangGraph, Ollama SDK, Anthropic API, OpenAI API |
| **Research Search** | Tavily API, DuckDuckGo (ddgs), arXiv, Semantic Scholar, HuggingFace, Stack Overflow |
| **Retrieval & Rerank** | BAAI BGE Reranker v2 M3, Cohere Rerank, Weaviate Hybrid Vector Store |
| **PDF Processing** | PyMuPDF (fitz), PDF.js / react-pdf |
| **Testing** | Backend: `pytest` (386+ tests) \| Frontend: `vitest` + React Testing Library (182+ tests) |
| **Container & Isolation** | Docker Engine, Docker Compose, Docker Sandbox Executor |

---

## 📋 Yêu cầu hệ thống

- **Python**: `>= 3.11`
- **Node.js**: `>= 20.x` & `npm`
- **uv**: Trình quản lý gói và môi trường Python siêu tốc (khuyên dùng)
- **Ollama**: Nền tảng chạy LLM local (nếu dùng các model như `llama3`, `qwen2.5-coder`, ...)
- **Docker Engine / Desktop**: Cần thiết nếu chạy toàn bộ app bằng Docker Compose hoặc sử dụng Docker Coding Sandbox.

---

## 🚀 Hướng dẫn Cài đặt & Chạy Local

### 1. Clone Repository

```bash
git clone https://github.com/NhuKiet/Persional-AI-Assistant.git
cd Persional-AI-Assistant
```

### 2. Cài đặt Python Dependencies (sử dụng `uv`)

```bash
uv sync --dev
```
*Lệnh này sẽ tự động khởi tạo môi trường `.venv` và cài đặt đầy đủ các gói cần thiết từ `uv.lock`.*

### 3. Cấu hình Môi trường `.env`

Tạo file `.env` từ file mẫu:

```bash
# Windows PowerShell
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

Các biến môi trường cơ bản để chạy local với Ollama:
```env
DEFAULT_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

Các API key nâng cao (tùy chọn):
- `ANTHROPIC_API_KEY`: Gọi các model Claude (Claude 3.5 Sonnet, Claude 3 Opus).
- `OPENAI_API_KEY`: Gọi OpenAI GPT-4o và sinh Embeddings cho Knowledge Store.
- `TAVILY_API_KEY`: Phụ trách nguồn tìm kiếm Web nâng cao cho Research.
- `WEAVIATE_URL` & `WEAVIATE_API_KEY`: Cấu hình vector database Weaviate Cloud.
- `SUPABASE_DB_URL`: Chuỗi kết nối PostgreSQL Supabase cho quản lý lịch sử phiên chat.

### 4. Chuẩn bị Ollama (Nếu dùng Local LLM)

```bash
ollama pull llama3
ollama serve
```

### 5. Khởi chạy Backend

Từ thư mục gốc dự án:

```bash
uv run uvicorn main:app --reload --port 8000
```
- Endpoint API Backend: `http://localhost:8000`
- Tài liệu API (Swagger UI): `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

### 6. Khởi chạy Frontend

Mở một Terminal khác:

```bash
cd frontend
npm ci
npm run dev
```
- Giao diện ứng dụng sẽ chạy tại: **`http://localhost:5173`** (hoặc port động như 5174/3000 - Backend CORS tự động chấp nhận các port `localhost` / `127.0.0.1`).

---

## 🐳 Khởi chạy bằng Docker Compose

Để đóng gói và chạy toàn bộ dịch vụ (Frontend + Backend):

```bash
docker compose up --build
```

Nguồn tài nguyên container:
- **Frontend (nginx)**: `http://localhost:5173`
- **Backend (FastAPI)**: `http://localhost:8000`

---

## 🔒 Bảo mật Coding Executor (Docker Sandbox)

Mã Python do LLM tạo ra là nguồn không tin cậy. KiNg áp dụng cơ chế cô lập nghiêm ngặt `EXECUTOR_MODE=docker`:

1. Build image sandbox executor:
   ```bash
   docker build -f Dockerfile.executor -t king-executor:latest .
   ```
2. Cấu hình `.env`:
   ```env
   EXECUTOR_MODE=docker
   EXECUTOR_IMAGE=king-executor:latest
   EXECUTOR_MEMORY=512m
   EXECUTOR_CPUS=1.0
   EXECUTOR_PIDS=128
   ```
*Mỗi lần chạy code sẽ khởi tạo một container tạm thời chỉ tồn tại trong thời gian thực thi, bị ngắt mạng hoàn toàn (`--network none`), đọc hệ thống file dạng Read-Only ngoại trừ `/tmp`, và thả bỏ mọi đặc quyền Linux Capabilities.*

---

## 🧪 Kiểm thử & Đảm bảo Chất lượng (Testing)

Dự án sở hữu bộ test tự động toàn diện được tích hợp với GitHub Actions CI:

### Kiểm thử Backend (Pytest)
```bash
uv run pytest
```
*Bao gồm 386+ test cases kiểm tra hợp đồng API (API Contracts), luồng RAG, công cụ Research, PDF Context, Supabase Session Store và Security Gate.*

### Kiểm thử Frontend (Vitest & TypeCheck)
```bash
cd frontend
npm run typecheck
npm run test
```
*Bao gồm 182+ unit/integration tests trên 27 test files đảm bảo tính ổn định của các Component, Hook, Layout PDF, Theme System và Route contracts.*

---

## 📂 Cấu trúc Dự án

```text
Persional-AI-Assistant/
├── main.py                        # Entrypoint re-export app FastAPI cho Uvicorn
├── backend/app/
│   ├── main.py                    # Cấu hình FastAPI app, middleware CORS, Routers
│   ├── core/                      # Config settings, LLM Factory, Lifespan lifecycle
│   ├── shared/                    # Supabase session store, Session locks, SSE encoders
│   └── features/
│       ├── chat/                  # Service, Router & Prompts cho Chat tổng quát
│       ├── research/              # Agent, Searchers (7 sources), Reranker, Knowledge Store
│       ├── coding/                # Coding agent, Docker executor, Artifact collector
│       ├── pdf/                   # PDF text extractor, Context ranker, Split workspace
│       └── models/                # Registry danh sách các Provider & Model
├── frontend/
│   ├── src/
│   │   ├── pages/                 # HomePage, ChatPage, ResearchPage, CodingPage, PdfPage, ToolPage
│   │   ├── components/            # Design system, Composer, Sidebar, ModelPicker, PDF controls
│   │   ├── hooks/                 # Custom React hooks (usePdfLayout, useTheme, useResearch, ...)
│   │   ├── styles/                # Hand-written CSS, Pearl Aurora design tokens, glass effects
│   │   └── test/                  # Vitest suite & Contract test files
│   └── vite.config.ts
├── tests/                         # Backend Pytest suite
├── Dockerfile                     # Dockerfile cho Backend
├── Dockerfile.executor            # Dockerfile cho Coding Sandbox Executor
├── docker-compose.yml             # Docker Compose orchestration
├── pyproject.toml                 # Cấu hình dự án & dependencies Python
└── uv.lock                        # Lockfile chuẩn hóa bởi uv
```

---

## 📄 Giấy phép & Đóng góp

Dự án được duy trì bởi **Nhukiet**. Mọi đóng góp, báo lỗi hoặc yêu cầu tính năng mới đều được hoan nghênh qua GitHub Issues và Pull Requests!
