# KiNg — Personal AI Assistant

<p align="center">
  <img src="frontend/src/assets/mainlogo.png" alt="KiNg logo" width="120" />
</p>

KiNg là trợ lý AI cá nhân chạy trên web, kết hợp trò chuyện, nghiên cứu nhiều nguồn, sinh và thực thi mã Python, cùng khả năng đọc tài liệu PDF. Ứng dụng hỗ trợ Ollama chạy local và các provider dùng API như Anthropic hoặc OpenAI.

> Dự án hiện hướng tới môi trường cá nhân hoặc phát triển nội bộ. API chưa có authentication, phân quyền người dùng hay rate limiting; không nên public trực tiếp lên Internet nếu chưa bổ sung các lớp bảo vệ này.

## Tổng quan

KiNg gồm một frontend React và backend FastAPI giao tiếp qua REST/SSE. Mỗi công cụ có URL riêng, lịch sử phiên riêng và bộ chọn model ngay trên giao diện.

| Workspace | URL | Chức năng đã có |
|---|---|---|
| Trợ lý | `/chat` | Chat streaming, Markdown, lịch sử hội thoại và chọn model |
| Research | `/research` | Tìm kiếm song song 7 nguồn, rerank, tổng hợp có nguồn tham khảo và deep dive |
| Coding | `/coding` | Lập kế hoạch, sinh code Python, chạy, tự debug và hiển thị artifact |
| Bài tập | `/tool/homework` | Chế độ gia sư giải thích từng bước qua hệ thống chat chung |
| Nghị luận | `/tool/essay` | Chế độ hỗ trợ lập luận, viết và cải thiện bài nghị luận |
| Email | `/tool/email` | Chế độ soạn email theo ngữ cảnh và giọng điệu |
| PDF Chat | `/pdf` | Upload, xem, tóm tắt, hỏi đáp và khoanh vùng nội dung PDF |

Trang `/` là landing page và nơi chọn công cụ. URL không hợp lệ được đưa về trang này.

## Tính năng đã có

### Trò chuyện và model

- Stream phản hồi bằng Server-Sent Events (SSE).
- Lưu lịch sử backend trong Supabase (Postgres) và giới hạn số message theo `MAX_HISTORY`.
- Lưu danh sách phiên và phiên đang dùng trên frontend bằng `localStorage`.
- Chọn provider/model riêng cho Chat, Research, Coding và PDF.
- Hỗ trợ Ollama, Anthropic và endpoint OpenAI-compatible.
- Giới hạn độ dài request bằng `MAX_MESSAGE_CHARS`.

### Research

- Tìm kiếm song song từ Tavily Web, DuckDuckGo, arXiv, Semantic Scholar, Hugging Face Papers và Stack Overflow.
- Query expansion cho các nguồn học thuật.
- Làm giàu nội dung web, loại kết quả gần trùng và rerank theo độ liên quan/độ tin cậy nguồn.
- Tổng hợp các mức tóm tắt, key points, bảng so sánh, dữ liệu biểu đồ, tài liệu tham khảo và câu hỏi tiếp theo.
- Deep dive trên một nguồn cụ thể.
- Cache kết quả tìm kiếm trong RAM trong 1 giờ, tối đa 50 query.
- Knowledge Store tùy chọn với OpenAI embeddings và Weaviate Cloud.

### Coding Agent

- Luồng `plan → generate → execute → debug` được stream lên giao diện.
- Hai chế độ: Coding Agent và chat hỗ trợ lập trình.
- Hỗ trợ output nhiều file Python.
- Upload CSV, JSON, JSONL, Excel, TXT, TSV, Parquet và XML theo từng session.
- Thu thập artifact PNG, JPG, GIF, SVG hoặc HTML do code tạo ra.
- Tùy chọn sinh test và review code qua `ENABLE_TESTS` / `ENABLE_REVIEW`.
- Hai executor: subprocess trên máy backend hoặc Docker container tạm thời.

### PDF Chat

- Upload PDF tối đa 50 MB, trích xuất text bằng PyMuPDF và xem trực tiếp bằng react-pdf.
- Chia đôi màn hình giữa tài liệu và hội thoại; tỷ lệ chia được lưu trên trình duyệt.
- Tóm tắt tài liệu và hỏi đáp dựa trên các đoạn liên quan.
- Chọn text hoặc khoanh vùng ảnh trên trang PDF để giải thích, thảo luận hoặc dịch.
- Pin ảnh yêu cầu model có khả năng xử lý hình ảnh; cấu hình Ollama mặc định không nhận pin ảnh.

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Frontend | React 18, TypeScript, Vite, React Router, react-pdf |
| Backend | FastAPI, Uvicorn, Pydantic Settings |
| Streaming | Server-Sent Events (SSE) |
| LLM | Ollama, Anthropic Claude, OpenAI/OpenAI-compatible qua LangChain |
| Research | Tavily, DuckDuckGo, arXiv, Semantic Scholar, Hugging Face, Stack Overflow |
| Retrieval | OpenAI embeddings, Weaviate hybrid search, BGE rerank và adapter Cohere tùy chọn |
| PDF | PyMuPDF, PDF.js/react-pdf |
| Storage | Supabase (Postgres), browser `localStorage`, Weaviate Cloud tùy chọn |
| Kiểm thử | pytest, Vitest, Testing Library |
| Đóng gói | Docker, Docker Compose, nginx |

## Yêu cầu hệ thống

- Python **3.11**.
- Node.js **20** và npm.
- Ollama nếu dùng model local.
- Docker Desktop/Engine nếu chạy bằng Docker Compose hoặc dùng Docker executor.
- RAM tối thiểu phụ thuộc model; reranker BGE và model Ollama có thể cần nhiều RAM/VRAM.

Các API key là tùy chọn theo tính năng:

| Biến | Dùng cho |
|---|---|
| `ANTHROPIC_API_KEY` | Hiển thị và gọi các model Anthropic |
| `OPENAI_API_KEY` | Model OpenAI và OpenAI embeddings cho Knowledge Store |
| `WEAVIATE_URL`, `WEAVIATE_API_KEY` | Lưu/tìm lại knowledge chunks trên Weaviate Cloud |
| `TAVILY_API_KEY` | Nguồn web (Tavily) trong Research; thiếu key thì riêng nguồn web bị tắt (DuckDuckGo vẫn chạy không cần key) |
| `S2_API_KEY` | Tăng rate limit của Semantic Scholar |
| `COHERE_API_KEY` | Dùng adapter Cohere rerank khi đã cài thêm SDK `cohere`; mặc định thử BGE local rồi fallback về base score |

## Cài đặt và chạy local

### 1. Clone repository

```bash
git clone https://github.com/NhuKiet/Persional-AI-Assistant.git
cd Persional-AI-Assistant
```

### 2. Cài đặt dependency Python bằng uv

Dự án dùng [uv](https://docs.astral.sh/uv/) để quản lý virtual environment và dependency qua `pyproject.toml`/`uv.lock`. Cài `uv` theo hướng dẫn chính thức, sau đó từ thư mục gốc:

```bash
uv sync --dev
```

Lệnh này tự tạo `.venv` và cài cả dependency runtime lẫn dev (pytest, ...). Không cần tự tạo virtual environment hay có `requirements.txt`.

### 3. Tạo file cấu hình

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Để chạy tối thiểu bằng Ollama, có thể giữ nguyên các giá trị mặc định chính:

```env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3
DEFAULT_PROVIDER=ollama
```

### 4. Chuẩn bị Ollama

```bash
ollama pull llama3
ollama serve
```

Nếu Ollama đã chạy như service thì không cần chạy lại `ollama serve`.

### 5. Chạy backend

Từ thư mục gốc:

```bash
uv run uvicorn main:app --reload --port 8000
```

Kiểm tra backend tại `http://localhost:8000/health`. OpenAPI UI của FastAPI có tại `http://localhost:8000/docs`.

### 6. Chạy frontend

Mở terminal thứ hai:

```bash
cd frontend
npm ci
npm run dev
```

Mở `http://localhost:5173`.

Frontend mặc định gọi backend tại `http://localhost:8000`. Có thể thay đổi lúc build bằng `VITE_API_URL`.

## Chạy bằng Docker Compose

Tạo `.env` trước, bảo đảm Ollama đang chạy trên máy host, sau đó:

```bash
docker compose up --build
```

Các service được mở tại:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

Trong Compose, backend gọi Ollama trên máy host qua `host.docker.internal:11434`. Volume `./data:/app/data` giữ lại PDF và sandbox khi container được tạo lại.

> `Dockerfile.executor` là image riêng để chạy code do Coding Agent sinh. Nó không được build tự động bởi `docker compose up --build`. Xem phần [Bảo mật Coding Executor](#bảo-mật-coding-executor).

## Cấu hình

Các cấu hình runtime có thể được ghi đè trong `.env`; mẫu triển khai thường dùng và chú thích có tại [`.env.example`](.env.example).

### LLM và provider

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `DEFAULT_PROVIDER` | `ollama` | `ollama`, `anthropic` hoặc `openai` |
| `DEFAULT_MODEL` | rỗng | Model mặc định; rỗng thì dùng model mặc định của provider |
| `OLLAMA_URL` | `http://localhost:11434` | Endpoint Ollama |
| `OLLAMA_MODEL` | `llama3` | Model local hiển thị trong Model Picker |
| `LLM_NUM_GPU` | `80` trong `.env.example` | Số layer GPU truyền cho ChatOllama |
| `OPENAI_BASE_URL` | rỗng | Endpoint OpenAI-compatible như LM Studio hoặc vLLM |

Ollama luôn được liệt kê trong Model Picker. Anthropic và OpenAI chỉ được liệt kê khi API key tương ứng có trong `.env`. Việc được liệt kê không tự kiểm tra server Ollama đang hoạt động.

### Giới hạn và hội thoại

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `MAX_MESSAGE_CHARS` | `24000` | Giới hạn tổng nội dung request chat/coding |
| `MAX_UPLOAD_MB` | `20` | Giới hạn upload dữ liệu cho Coding |
| `MAX_HISTORY` | `20` | Số message backend giữ cho mỗi lịch sử |
| `CODE_TIMEOUT` | `30` | Thời gian tối đa cho một lần thực thi code |
| `MAX_DEBUG_ITER` | `4` | Số vòng debug tối đa của Coding Agent |
| `MAX_OUTPUT_LEN` | `8000` | Số ký tự stdout/stderr tối đa trả về UI |

PDF có giới hạn upload cố định 50 MB ở cả frontend và backend.

### Research và Knowledge Store

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `KNOWLEDGE_THRESHOLD` | `0.65` | Ngưỡng nhận kết quả retrieval |
| `KNOWLEDGE_CHUNK_SIZE` | `500` | Kích thước child chunk |
| `KNOWLEDGE_OVERLAP` | `50` | Độ chồng lấn chunk |
| `KNOWLEDGE_TOP_K` | `40` | Số candidate retrieval |
| `RERANK_ENABLED` | `true` | Bật rerank cho Knowledge Store |
| `RERANK_GATE_THRESHOLD` | `0.5` | Ngưỡng chấp nhận sau rerank |
| `RERANK_CANDIDATES` | `30` | Số candidate đưa vào reranker |
| `RERANKER_MODEL` | `BAAI/bge-reranker-v2-m3` | Model BGE local |

Research vẫn tìm kiếm và tổng hợp khi Weaviate/OpenAI embeddings chưa được cấu hình. Trong trường hợp đó, bước đọc/ghi Knowledge Store được bỏ qua và ghi warning vào log.

### PDF

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `PDF_UPLOAD_DIR` | `data/pdfs` | Thư mục PDF runtime |
| `PDF_CHUNK_SIZE` | `800` | Kích thước đoạn text PDF |
| `PDF_CHUNK_OVERLAP` | `100` | Độ chồng lấn giữa các đoạn |
| `PDF_MAX_CONTEXT` | `6000` | Giới hạn context cho một câu hỏi PDF |

## Cách sử dụng

### Trợ lý và các chế độ chuyên biệt

Vào `/chat` để trò chuyện tổng quát. Ba workspace Bài tập, Nghị luận và Email dùng chung endpoint chat nhưng có system prompt riêng, nên phản hồi được định dạng theo từng mục đích.

### Research

1. Mở `/research` và nhập chủ đề.
2. Theo dõi trạng thái từng nguồn trong quá trình tìm kiếm.
3. Xem phần tổng hợp, key points, bảng so sánh, biểu đồ và references.
4. Mở một nguồn để hỏi sâu bằng Deep Dive hoặc dùng câu hỏi gợi ý tiếp theo.

Không phải nguồn nào cũng luôn trả về kết quả. Mỗi nguồn chạy độc lập; lỗi hoặc thiếu key ở một nguồn không nhất thiết làm hỏng toàn bộ phiên Research.

### Coding

1. Chọn chế độ Agent để yêu cầu tạo/chạy code hoặc Chat để chỉ trao đổi về lập trình.
2. Có thể upload file dữ liệu trước khi chạy Agent.
3. Agent stream kế hoạch, code, kết quả thực thi và các vòng debug.
4. Artifact hợp lệ xuất hiện trong bảng kết quả để xem lại.

### PDF Chat

1. Mở `/pdf`, kéo thả hoặc chọn một file PDF.
2. Đọc tài liệu ở panel trái và hỏi đáp ở panel phải.
3. Chọn text hoặc kéo vùng ảnh để ghim ngữ cảnh.
4. Dùng nút Tóm tắt để tạo bản tóm tắt tài liệu.

PDF dạng scan không có text vẫn có thể hiển thị, nhưng retrieval bằng text sẽ hạn chế. Muốn hỏi về vùng ảnh, hãy chọn model vision từ Anthropic/OpenAI đã cấu hình.

## Kiến trúc

```text
Browser
  │
  ├── React + React Router
  │     ├── Landing / Chat / Tool modes
  │     ├── Research workspace
  │     ├── Coding workspace
  │     └── PDF split view
  │
  └── REST + SSE
        │
        └── FastAPI
              ├── LLM factory (Ollama / Anthropic / OpenAI)
              ├── Supabase conversation store
              ├── Research Agent + Knowledge Store
              ├── Coding Agent + Code Executor
              └── PDF processor + multimodal context
```

Các route nặng (`/research`, `/coding`, `/pdf`, `/tool/:toolId`) được lazy-load. Mỗi route được bọc bởi `Suspense` và `ErrorBoundary` riêng để lỗi một workspace không kéo sập toàn bộ router.

### Research pipeline

```text
Query
  ├── Knowledge Store retrieval (nếu đã cấu hình)
  │     └── Hybrid search → rerank → relevance gate
  │
  └── Nếu không có knowledge hit
        ├── Query expansion
        ├── Tìm kiếm song song 7 nguồn
        ├── Enrich web content
        ├── Deduplicate
        ├── Rerank top sources
        └── Lưu knowledge chunks nếu Weaviate khả dụng

Selected sources → LLM synthesis → summaries / points / tables / refs
```

### Coding pipeline

```text
Yêu cầu
  → Stream kế hoạch JSON
  → Stream code Python
  → Thực thi trong sandbox theo session
  → Trả stdout/stderr và artifact
  → Nếu lỗi: LLM sửa code và chạy lại (tối đa MAX_DEBUG_ITER)
  → Tùy chọn: sinh test và review
```

### PDF pipeline

```text
Upload PDF
  → PyMuPDF trích xuất text theo trang
  → Chia chunk có overlap
  → Xếp hạng chunk bằng từ khóa cho từng câu hỏi
  → Ghép text/pin vùng chọn vào context
  → LLM stream câu trả lời
```

Tóm tắt PDF hiện lấy tối đa 3.000 ký tự đầu từ nội dung đã trích xuất. Đây là giới hạn của implementation hiện tại, không phải tóm tắt phân cấp toàn bộ tài liệu dài.

## API

FastAPI tự sinh OpenAPI tại `/docs` và `/openapi.json`.

| Method | Endpoint | Chức năng |
|---|---|---|
| `GET` | `/health` | Health check và version backend |
| `GET` | `/api/models` | Danh sách model khả dụng và model mặc định |
| `POST` | `/api/chat/stream` | Chat streaming qua SSE |
| `DELETE` | `/api/chat/session/{session_id}` | Xóa lịch sử chat backend |
| `POST` | `/api/research/stream` | Chạy Research pipeline qua SSE |
| `POST` | `/api/research/deep-dive` | Hỏi sâu dựa trên một source qua SSE |
| `DELETE` | `/api/research/cache` | Xóa Research cache trong RAM |
| `GET` | `/api/paper/{filename}` | Trả file PDF paper đã tải về |
| `POST` | `/api/coding/upload` | Upload file dữ liệu theo `session_id` |
| `DELETE` | `/api/coding/file/{filename}` | Xóa file upload theo `session_id` query |
| `POST` | `/api/coding/stream` | Chạy Coding Agent hoặc Coding Chat qua SSE |
| `GET` | `/api/coding/artifact/{session_id}/{filename}` | Trả artifact theo session |
| `GET` | `/api/coding/artifact/{filename}` | Endpoint artifact cũ ở sandbox gốc |
| `GET` | `/api/coding/session/{session_id}` | Đọc lịch sử Coding backend |
| `DELETE` | `/api/coding/session/{session_id}` | Xóa lịch sử Coding backend |
| `POST` | `/api/pdf/upload` | Upload và trích xuất PDF |
| `GET` | `/api/pdf/list` | Liệt kê PDF runtime |
| `GET` | `/api/pdf/raw/{filename}` | Trả PDF để frontend hiển thị |
| `DELETE` | `/api/pdf/file/{filename}` | Xóa PDF runtime |
| `POST` | `/api/pdf/stream` | Hỏi đáp PDF qua SSE |
| `POST` | `/api/pdf/summarize` | Tóm tắt PDF qua SSE |

Các endpoint SSE trả từng event theo định dạng:

```text
data: {"type":"token","content":"..."}

```

## Lưu trữ dữ liệu

| Dữ liệu | Vị trí | Vòng đời |
|---|---|---|
| Lịch sử hội thoại backend | Supabase (Postgres), bảng `sessions`/`messages` | Startup xóa session cũ hơn 30 ngày (`_store.cleanup_old`) |
| Danh sách phiên frontend | Browser `localStorage` | Theo trình duyệt và từng tool |
| File Coding và artifact | `data/sandbox/<session_id>/` | Runtime, không commit Git |
| PDF upload | `data/pdfs/` | Runtime, giữ đến khi người dùng xóa |
| Paper PDF | `data/papers/` | Runtime |
| Research query cache | RAM backend | TTL 1 giờ, tối đa 50 query, mất khi restart |
| Knowledge chunks | Weaviate Cloud | Persistent khi đã cấu hình |

## Kiểm thử và CI

Backend:

```bash
uv run pytest -q
```

Frontend:

```bash
cd frontend
npm run typecheck
npm run test
npm run build
```

GitHub Actions chạy các bước sau cho mỗi push và pull request:

- Python: `astral-sh/setup-uv`, `uv sync --dev`, sau đó `uv run pytest -q`.
- Node 20: `npm ci`, typecheck, Vitest (`npm run test`) và Vite production build.

## Bảo mật Coding Executor

Code do LLM sinh là code không đáng tin cậy. KiNg chỉ hỗ trợ MỘT chế độ thực
thi: `EXECUTOR_MODE=docker` (giá trị mặc định và duy nhất — Settings từ chối
mọi giá trị khác lúc khởi động). Mỗi lần chạy tạo một container tạm thời với
`--network none`, root filesystem read-only (`/tmp` là tmpfs 64m), giới hạn
RAM/CPU/PID, `--cap-drop ALL`, `--security-opt no-new-privileges:true`, chạy
dưới UID/GID không phải root, và chỉ mount sandbox của session. Nếu Docker
daemon không sẵn sàng, executor trả về kết quả "unavailable" — KHÔNG BAO GIỜ
chạy code do LLM sinh trực tiếp trên host bằng subprocess.

Build image executor:

```bash
docker build -f Dockerfile.executor -t king-executor:latest .
```

Sau đó đặt:

```env
EXECUTOR_MODE=docker
EXECUTOR_IMAGE=king-executor:latest
EXECUTOR_MEMORY=512m
EXECUTOR_CPUS=1.0
EXECUTOR_PIDS=128
```

Lưu ý:

- Backend phải gọi được Docker CLI/daemon. Backend chạy trong Compose hiện không mount Docker socket và image backend không cài Docker CLI; muốn dùng Docker executor trong mô hình đó phải cấu hình thêm hạ tầng phù hợp.
- Nếu Docker không khả dụng, chạy code sẽ báo lỗi "không khả dụng" cho người dùng thay vì thực thi trên host — không có fallback.
- Giữ `ENABLE_AUTO_INSTALL=false`. Tùy chọn hiện tại gọi `pip install` từ tiến trình backend, vì vậy có thể thay đổi môi trường Python của backend.
- Docker executor giảm rủi ro nhưng không thay thế authentication, authorization, audit log và các biện pháp hardening khi triển khai nhiều người dùng.

## Cấu trúc dự án

```text
Persional-AI-Assistant/
├── main.py                        # Re-export backend.app.main:app cho uvicorn
├── backend/app/
│   ├── main.py                    # FastAPI app, CORS, router include, health check
│   ├── core/
│   │   ├── config.py              # Nguồn cấu hình từ .env
│   │   ├── llm.py                 # LLM factory đa provider
│   │   └── lifespan.py            # Startup/shutdown (dọn session cũ, ...)
│   ├── shared/
│   │   ├── conversation_store.py  # Supabase (Postgres) conversation store dùng chung
│   │   ├── session_locks.py       # Khóa mutation theo session
│   │   ├── sse.py                 # Parser/encoder SSE dùng chung
│   │   └── files.py                # Tiện ích file/path an toàn
│   └── features/
│       ├── chat/                  # Router, service, prompts, schemas cho Chat
│       ├── research/              # Agent, search/, synthesizer, security, knowledge store
│       ├── coding/                # Router, service, execution, artifacts, uploads
│       ├── pdf/                   # Router, service, processor, context
│       └── models/                # Model registry cho frontend
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Router, lazy routes, route boundaries
│   │   ├── pages/             # Landing, Chat, Research, Coding, PDF, Tool
│   │   ├── components/        # UI dùng chung và feature components
│   │   ├── hooks/             # Chat/Research/Coding/history hooks
│   │   ├── pdf/               # PDF viewer và selection layer
│   │   ├── config/            # Tool/model display configuration
│   │   └── styles/            # CSS theo khu vực và design tokens
│   ├── Dockerfile             # Vite build → nginx
│   └── nginx.conf             # SPA fallback và asset cache
├── tests/                     # pytest backend
├── docs/superpowers/          # Design specs và implementation plans
├── Dockerfile                 # Backend image
├── Dockerfile.executor        # Coding sandbox image
├── docker-compose.yml         # Backend + frontend
├── pyproject.toml             # Dependency và tool config (dùng với uv)
├── uv.lock                    # Lockfile cho uv sync
└── .env.example
```

Thư mục `data/`, `.env`, virtual environment, frontend build và dependency folders đều được loại khỏi Git.

## Xử lý sự cố

### Model local không phản hồi

Kiểm tra Ollama và model:

```bash
ollama list
ollama serve
```

Đảm bảo `OLLAMA_URL` đúng với nơi backend đang chạy. Trong Docker Compose, dùng `host.docker.internal`, không dùng `localhost` để trỏ từ container về Ollama trên host.

### Provider không xuất hiện trong Model Picker

Anthropic/OpenAI chỉ xuất hiện khi API key tương ứng có trong `.env`. Sau khi đổi `.env`, restart backend để `Settings` và model registry được nạp lại.

### Research thiếu kết quả web

Kiểm tra `TAVILY_API_KEY`. Nếu thiếu, WebSearcher (Tavily) bị tắt nhưng DuckDuckGo, arXiv, Hugging Face, Semantic Scholar và Stack Overflow vẫn có thể chạy.

### Knowledge Store luôn báo skip

Cần đồng thời có `WEAVIATE_URL`, `WEAVIATE_API_KEY` và `OPENAI_API_KEY`. Thiếu một trong các cấu hình này thì Research vẫn chạy live search nhưng không đọc/ghi knowledge chunks.

### Frontend không kết nối backend

Kiểm tra backend tại `http://localhost:8000/health` và giá trị `VITE_API_URL`. CORS mặc định cho phép các origin development `localhost:5173`, `localhost:3000` và `127.0.0.1:5173`.

### Reload route bị 404 khi deploy

Web server phải fallback các route như `/research` hoặc `/pdf` về `index.html`. File `frontend/nginx.conf` đã cấu hình `try_files $uri $uri/ /index.html` cho image frontend.
