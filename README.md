# KiNg — Personal AI Assistant

<p align="center">
  <img src="frontend/src/assets/mainlogo.png" alt="KiNg logo" width="120" />
</p>

<p align="center">
  <em>Một trợ lý AI cá nhân chạy trên trình duyệt: trò chuyện, nghiên cứu sâu đa nguồn,
  sinh &amp; chạy code Python trong sandbox, đọc PDF, và điểm tin AI hằng ngày —
  tất cả trong một lõi xử lý duy nhất.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.11+-blue" alt="Python 3.11+" />
  <img src="https://img.shields.io/badge/node-20+-green" alt="Node 20+" />
  <img src="https://img.shields.io/badge/react-18-61dafb" alt="React 18" />
  <img src="https://img.shields.io/badge/FastAPI-SSE-009688" alt="FastAPI" />
</p>

KiNg chạy được với **LLM local qua Ollama** hoặc **API provider** (Anthropic Claude,
OpenAI / endpoint OpenAI-compatible), đổi model ngay trên giao diện mà không cần khởi
động lại. Mọi phản hồi dài đều stream về client theo thời gian thực bằng
Server-Sent Events.

> [!WARNING]
> Dự án hướng tới môi trường **cá nhân / phát triển nội bộ**. API chưa có lớp
> authentication, phân quyền hay rate-limiting đa người dùng. Đừng expose thẳng ra
> Internet nếu chưa bổ sung các lớp bảo vệ đó.

---

## Mục lục

- [Tính năng](#-tính-năng)
- [Kiến trúc](#-kiến-trúc)
- [Công nghệ](#-công-nghệ)
- [Yêu cầu hệ thống](#-yêu-cầu-hệ-thống)
- [Cài đặt & chạy local](#-cài-đặt--chạy-local)
- [Chạy bằng Docker Compose](#-chạy-bằng-docker-compose)
- [Sandbox thực thi code](#-sandbox-thực-thi-code)
- [Cấu hình (.env)](#️-cấu-hình-env)
- [API](#-api)
- [Kiểm thử & CI](#-kiểm-thử--ci)
- [Cấu trúc dự án](#-cấu-trúc-dự-án)
- [Giấy phép](#-giấy-phép)

---

## ✨ Tính năng

### Trang chủ — "Capability Reactor" (`/`)

Landing một màn hình: lõi phản ứng 3D dựng bằng **Three.js** (kéo để xoay, cuộn để
phóng) đặt trong một card rêu ô liu bo góc, cùng hero giới thiệu và một CTA duy nhất
dẫn vào trợ lý. Canvas tự nhận diện máy yếu để hạ cấu hình, và có fallback tĩnh nếu
WebGL không khởi tạo được.

### Trò chuyện (`/chat`)

- Stream phản hồi theo thời gian thực qua **SSE**.
- **Model Picker** đổi provider/model ngay trên thanh điều khiển (Ollama · Anthropic ·
  OpenAI / OpenAI-compatible).
- Render Markdown, code block có tô màu cú pháp và nút copy.
- Lịch sử hội thoại lưu trên **Supabase (Postgres)**, khôi phục được theo `session_id`;
  danh sách phiên hiển thị ở sidebar.
- Dock công cụ để nhảy sang các chế độ chuyên biệt.

### Nghiên cứu sâu (`/research`)

- **Tìm song song nhiều nguồn**: Tavily Web, DuckDuckGo, arXiv, Semantic Scholar,
  Hugging Face Papers, Stack Overflow — rồi tới bước tổng hợp.
- **Knowledge Gate**: phân loại độ đầy đủ của tri thức sẵn có (`EMPTY` / `STALE` /
  `THIN` / `MAYBE`) để quyết định tìm thêm hay trả lời luôn, tránh tốn lượt tìm kiếm.
- **Rerank & khử trùng lặp** bằng `BAAI/bge-reranker-v2-m3` chạy local (hoặc Cohere
  Rerank nếu có key).
- **Grounding & trích dẫn**: câu trả lời gắn nguồn, kèm bước kiểm tra trích dẫn.
- **Deep dive** từng nguồn và gợi ý câu hỏi tiếp theo theo ngữ cảnh.
- **Knowledge store (tuỳ chọn)**: hybrid vector search trên **Weaviate Cloud** +
  OpenAI Embeddings để tái sử dụng tri thức đã thu thập.

### Coding Agent (`/coding`)

- Vòng lặp tự động **Plan → Code → Execute → Debug**, tự sửa lỗi tối đa
  `MAX_DEBUG_ITER` vòng.
- Sinh project Python nhiều file; upload dữ liệu (CSV, JSON, JSONL, Excel, Parquet,
  TXT, TSV, XML) để phân tích.
- Thu **artifact** do code sinh ra (PNG, JPG, SVG, HTML) và hiển thị ngay trong app.
- Mọi lần chạy đều diễn ra trong **container Docker dùng một lần** — xem
  [Sandbox thực thi code](#-sandbox-thực-thi-code).

### Trợ lý PDF (`/pdf`)

- **Workspace chia đôi** tài liệu / hỏi đáp, kéo chỉnh tỉ lệ; tự đổi bố cục theo khổ
  màn hình (split ở desktop, drawer ở laptop, overlay ở màn hẹp).
- Trích xuất nội dung bằng **PyMuPDF**, render bằng **react-pdf / PDF.js**, có outline
  và tìm kiếm highlight trong trang.
- **Ghim ngữ cảnh**: bôi đen đoạn text hoặc khoanh vùng ảnh trên trang để hỏi riêng về
  phần đó (vùng ảnh đi qua model vision).
- Tóm tắt nhanh toàn tài liệu bằng một nút.

### Điểm tin AI (`/news`)

- Tổng hợp định kỳ từ các **RSS đã tuyển chọn**: OpenAI, Google DeepMind, Hugging
  Face, arXiv cs.AI & cs.RO, IEEE Spectrum Robotics, Hacker News.
- LLM tóm tắt từng tin, phân nhóm theo chủ đề (model release · research · robotics ·
  community).
- Refresh theo lịch **single-flight**: tick tự động và refresh thủ công trùng thời
  điểm sẽ dùng chung một lần chạy pipeline thay vì mỗi bên chạy (và trả phí) riêng.

### Bong bóng "Trợ lý nhanh"

Bong bóng chat nổi ở mọi trang, bridge sang một dự án **ai-agent (Telegram bot)** chạy
riêng qua `BRIDGE_URL` / `BRIDGE_TOKEN`. Tách biệt hoàn toàn với chat chính của KiNg.

---

## 🏛 Kiến trúc

```text
Trình duyệt (React 18 + Vite)
        │  fetch + Server-Sent Events
        ▼
FastAPI (Uvicorn)  ──►  LLM: Ollama | Anthropic | OpenAI-compatible
        │
        ├─► Supabase Postgres   (lịch sử phiên & tin nhắn)
        ├─► Weaviate Cloud      (knowledge store — tuỳ chọn)
        ├─► Search APIs         (Tavily · DuckDuckGo · arXiv · S2 · HF · SO)
        └─► Docker Executor     (container dùng một lần, chạy code sinh ra)
```

Backend cắt theo **feature slice**: mỗi tính năng là một thư mục riêng trong
`backend/app/features/` với router + service + schema của chính nó, dùng chung phần
`core/` (config, LLM factory, lifespan, capabilities) và `shared/` (conversation store,
session lock, SSE encoder). Có test canh **ranh giới giữa các feature** để chúng không
import chéo lung tung.

Frontend là **React Router v6 SPA**, mỗi tính năng một route. Landing và trang chat
được nạp sẵn (eager) vì là điểm vào chính; các trang nặng — nhất là PDF, kéo theo
react-pdf + pdfjs worker — được **lazy-load** theo route. Mỗi route bọc trong
`ErrorBoundary` riêng nên một trang lỗi không kéo sập cả router.

**Hệ thống thiết kế** là CSS thuần dựa trên design token, hai theme:

- **Warm Paper** (sáng, mặc định) — nền giấy ấm, accent đất nung.
- **Mực tối** — nền mực, accent vàng đồng.

Toàn bộ icon là **SVG nội tuyến đơn sắc** vẽ bằng `currentColor` (không dùng thư viện
icon, không dùng emoji) để màu luôn bám theo token của theme.

---

## 🧰 Công nghệ

| Mảng | Công nghệ |
|---|---|
| **Frontend** | React 18 · TypeScript · Vite 5 · React Router v6 · Three.js · react-pdf |
| **Styling** | CSS thuần + design token, hai theme, SVG nội tuyến |
| **Backend** | Python 3.11+ · FastAPI · Uvicorn · Pydantic Settings · asyncio |
| **Streaming** | Server-Sent Events qua `StreamingResponse` |
| **LLM** | Ollama · Anthropic · OpenAI / OpenAI-compatible · LangChain / LangGraph |
| **Lưu trữ** | Supabase (Postgres) qua `psycopg` pool · `localStorage` phía client |
| **Tìm kiếm** | Tavily · DuckDuckGo (ddgs) · arXiv · Semantic Scholar · Hugging Face · Stack Overflow |
| **Retrieval** | BGE Reranker v2 M3 · Cohere Rerank · Weaviate hybrid search · OpenAI Embeddings |
| **PDF** | PyMuPDF (fitz) phía server · PDF.js / react-pdf phía client |
| **Sandbox** | Docker Engine — container dùng một lần, không mạng |
| **Kiểm thử** | pytest (backend) · Vitest + React Testing Library (frontend) |

---

## 📋 Yêu cầu hệ thống

| | Bắt buộc | Ghi chú |
|---|---|---|
| **Python** | ✅ `>= 3.11` | |
| **Node.js** | ✅ `>= 20` + npm | |
| **Docker** | ✅ | Bắt buộc cho Coding Agent — `EXECUTOR_MODE=docker` là giá trị duy nhất được chấp nhận |
| **uv** | khuyên dùng | Trình quản lý môi trường/gói Python |
| **Ollama** | tuỳ chọn | Chỉ cần khi chạy LLM local |
| **GPU NVIDIA** | tuỳ chọn | Tăng tốc BGE reranker; không có thì torch tự rơi về CPU |

---

## 🚀 Cài đặt & chạy local

### 1. Clone

```bash
git clone https://github.com/NhuKiet/Persional-AI-Assistant.git
```

### 2. Cài dependency Python

```bash
uv sync --dev
```

Lệnh này tự tạo `.venv` và cài đúng phiên bản đã khoá trong `uv.lock`.

### 3. Tạo file `.env`

```bash
cp .env.example .env
```

Trên Windows PowerShell:

```bash
Copy-Item .env.example .env
```

Cấu hình tối thiểu để chạy với Ollama — xem [Cấu hình (.env)](#️-cấu-hình-env) cho
danh sách đầy đủ:

```env
DEFAULT_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

### 4. Chuẩn bị model local (nếu dùng Ollama)

```bash
ollama pull llama3
```

### 5. Chạy backend

```bash
uv run uvicorn main:app --reload --port 8000
```

- API: `http://localhost:8000`
- Swagger UI: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

### 6. Chạy frontend

Mở terminal thứ hai:

```bash
npm ci --prefix frontend
```

```bash
npm run dev --prefix frontend
```

Giao diện chạy ở `http://localhost:5173`. Backend tự chấp nhận CORS từ mọi cổng
`localhost` / `127.0.0.1` nên đổi port cũng không sao.

### 7. (Tuỳ chọn) Bật nhận dạng công thức viết tay — HMER

`/hmer` dùng mô hình SwinCoMER ở repo riêng `CapstoneProject_SP25AI12`. Cả package
lẫn checkpoint đều **không** nằm trong repo này và **không** có trong `uv.lock` —
thiếu chúng thì app vẫn chạy, chỉ riêng HMER báo `disabled`.

**Cài package model, không kéo dependency của repo capstone.** `requirements.txt`
bên đó ghim `matplotlib==3.5.1` (KiNg dùng 3.10.8) và kèm tool dev; `setup.py`
cần `pkg_resources` nên phải ép setuptools cũ khi build:

```bash
echo "setuptools<81" > /tmp/hmer-build.txt
```

```bash
uv pip install --no-deps --build-constraint /tmp/hmer-build.txt -e <đường-dẫn>/CapstoneProject_SP25AI12/SwinCoMER
```

**Cài các thư viện mà model import khi chạy:**

```bash
uv pip install pytorch-lightning timm==1.0.29 einops torchmetrics albumentations opencv-python-headless
```

`timm` phải là 1.0.29: checkpoint hiện có chạy encoder ở chế độ "legacy", chỉ đúng
khi timm trả feature map dạng NHWC. `torchvision` phải khớp đúng bản torch trong
`uv.lock` — trên Windows là `2.14.0+cu126`:

```bash
uv pip install --no-deps --index-url https://download.pytorch.org/whl/cu126 torchvision==0.29.0
```

**Trỏ tới checkpoint** trong `.env` — chỉ bản `0.4713` khớp `dictionary.txt` của
model; bản `0.4245` vẫn nạp được nhưng ra token sai mà không báo lỗi:

```env
HMER_CHECKPOINT=<đường-dẫn>/ComerSwin-epoch=02-val_ExpRate=0.4713.ckpt
```

> [!IMPORTANT]
> Từ đây luôn đồng bộ bằng `uv sync --dev --inexact`. `uv sync --dev` thường sẽ gỡ
> mọi package không có trong `uv.lock` — tức toàn bộ phần vừa cài — và
> `/api/hmer/status` sẽ báo thiếu package.

Lần nạp model đầu tiên cần mạng (timm tải trọng số ImageNet rồi ghi đè bằng
checkpoint). Trên CPU mỗi ảnh mất ~7 phút, nên máy Windows dùng torch bản CUDA
(khai báo trong `pyproject.toml`).

---

## 🐳 Chạy bằng Docker Compose

```bash
docker compose up --build
```

- Frontend (nginx): `http://localhost:5173`
- Backend (FastAPI): `http://localhost:8000`

Vài điểm compose đã xử lý sẵn:

- **Ollama và Supabase chạy trên máy host**, không phải trong container — compose trỏ
  qua `host.docker.internal`. Nhớ điền `SUPABASE_DB_URL_DOCKER` (cùng connection string
  nhưng đổi host) vì container không resolve được `127.0.0.1` về máy host.
- **Cache model HuggingFace** được gắn volume riêng. Thiếu volume này thì sau mỗi lần
  rebuild, câu hỏi research **đầu tiên** sẽ treo hàng phút để tải lại reranker (~2GB).
- **GPU NVIDIA** của host được khai báo sẵn cho backend; không có GPU/driver thì torch
  tự chuyển sang CPU chứ không lỗi.

---

## 🔒 Sandbox thực thi code

Code Python do LLM sinh ra là **đầu vào không tin cậy**, nên KiNg chỉ chạy nó trong
Docker — `EXECUTOR_MODE` không nhận giá trị nào khác, sai là Settings từ chối ngay lúc
khởi động.

Build image executor một lần:

```bash
docker build -f Dockerfile.executor -t king-executor:latest .
```

Rồi cấu hình trong `.env`:

```env
EXECUTOR_MODE=docker
EXECUTOR_IMAGE=king-executor:latest
EXECUTOR_MEMORY=512m
EXECUTOR_CPUS=1.0
EXECUTOR_PIDS=128
```

Mỗi lần chạy sinh một container tạm, sống đúng trong thời gian thực thi, với:

| Lớp cô lập | Thiết lập |
|---|---|
| Mạng | `--network none` — cắt hoàn toàn |
| Filesystem | read-only, trừ `/tmp` |
| Bộ nhớ / CPU / tiến trình | giới hạn theo `EXECUTOR_MEMORY` · `EXECUTOR_CPUS` · `EXECUTOR_PIDS` |
| Đặc quyền | drop toàn bộ Linux capabilities |
| Thời gian | cắt theo `CODE_TIMEOUT` |

> [!CAUTION]
> `ENABLE_AUTO_INSTALL=true` cho phép code sinh ra tự `pip install`. Chỉ bật khi
> executor đang chạy ở chế độ Docker.

---

## ⚙️ Cấu hình (.env)

`.env.example` là nguồn tham chiếu đầy đủ, có chú thích từng biến. Tóm tắt theo nhóm:

| Nhóm | Biến tiêu biểu |
|---|---|
| **LLM** | `DEFAULT_PROVIDER` · `DEFAULT_MODEL` · `OLLAMA_URL` · `OLLAMA_MODEL` · `LLM_NUM_GPU` · `LLM_TIMEOUT` |
| **API key** | `ANTHROPIC_API_KEY` · `OPENAI_API_KEY` · `OPENAI_BASE_URL` |
| **Tìm kiếm** | `TAVILY_API_KEY` (cần cho web search) · `S2_API_KEY` (tuỳ chọn, nới rate limit) |
| **Knowledge store** | `WEAVIATE_URL` · `WEAVIATE_API_KEY` · `OPENAI_EMBEDDING_MODEL` · `KNOWLEDGE_*` |
| **Rerank** | `RERANKER_MODEL` · `RERANK_ENABLED` · `RERANK_GATE_THRESHOLD` · `COHERE_API_KEY` |
| **Lưu trữ** | `SUPABASE_DB_URL` · `SUPABASE_DB_URL_DOCKER` |
| **Coding** | `CODE_TIMEOUT` · `MAX_DEBUG_ITER` · `ENABLE_AUTO_INSTALL` · `EXECUTOR_*` |
| **Giới hạn** | `MAX_MESSAGE_CHARS` · `MAX_UPLOAD_MB` · `MAX_HISTORY` |
| **PDF** | `PDF_MAX_CONTEXT` · `PDF_CHUNK_SIZE` · `PDF_CHUNK_OVERLAP` |
| **Bubble** | `BRIDGE_URL` · `BRIDGE_TOKEN` |

DuckDuckGo và Stack Overflow không cần API key.

---

## 🔌 API

Tất cả endpoint nằm dưới `/api`. Các endpoint `*/stream` trả về **SSE**, phần còn lại
trả JSON. Chi tiết schema xem Swagger UI tại `/docs`.

| Nhóm | Endpoint |
|---|---|
| **Chat** | `POST /api/chat/stream` · `GET /api/chat/sessions/{id}` · `DELETE /api/chat/session/{id}` |
| **Research** | `POST /api/research/stream` · `POST /api/research/deep-dive` · `GET /api/research/trending` · `GET /api/research/sessions/{id}` |
| **Coding** | `POST /api/coding/stream` · `POST /api/coding/upload` · `GET /api/coding/artifact/{...}` · `DELETE /api/coding/file/{name}` · `GET /api/coding/sessions/{id}` |
| **PDF** | `POST /api/pdf/upload` · `GET /api/pdf/list` · `GET /api/pdf/raw/{name}` · `POST /api/pdf/stream` · `POST /api/pdf/summarize` · `DELETE /api/pdf/file/{name}` |
| **News** | `GET /api/news` · `POST /api/news/refresh` |
| **Models** | `GET /api/models` |
| **Bubble** | `POST /api/bubble/chat` · `POST /api/bubble/reset` |
| **Health** | `GET /health` |

---

## 🧪 Kiểm thử & CI

### Backend — pytest

```bash
uv run pytest
```

Khoảng 590 test trên 65 file, phủ: hợp đồng API, luồng research (gate, grounding,
trích dẫn, iteration), coding service & Docker executor, PDF context, news
fetcher/scheduler, session store trên Supabase, capability registry, và cả ranh giới
import giữa các feature.

### Frontend — Vitest + typecheck

```bash
npm run typecheck --prefix frontend
```

```bash
npm run test --prefix frontend
```

269 test trên 39 file, phủ: component, hook, bố cục PDF, hệ theme, và hợp đồng route
(đi qua `<App />` thật, chỉ khẳng định những gì người dùng nhìn thấy — nhờ vậy test
sống sót qua refactor).

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) chạy trên mọi push và pull
request: backend `pytest`; frontend `typecheck` → `test` → `build`.

---

## 📂 Cấu trúc dự án

```text
Persional-AI-Assistant/
├── main.py                     # Entrypoint re-export app FastAPI cho Uvicorn
├── backend/app/
│   ├── main.py                 # Khởi tạo FastAPI, CORS, đăng ký router
│   ├── core/                   # config · llm factory · lifespan · capabilities
│   ├── shared/                 # conversation store · session lock · SSE · files
│   └── features/               # mỗi tính năng một slice: router + service + schema
│       ├── chat/               #   chat tổng quát + prompt theo từng chế độ
│       ├── research/           #   agent, searcher đa nguồn, rerank, knowledge store
│       ├── coding/             #   agent plan→code→run→debug, docker executor, artifact
│       ├── pdf/                #   trích xuất, xếp hạng ngữ cảnh, hỏi đáp tài liệu
│       ├── news/               #   RSS fetcher, summarizer, scheduler, store
│       ├── models/             #   registry provider & model
│       └── assistant_bubble/   #   bridge sang ai-agent bên ngoài
├── frontend/
│   └── src/
│       ├── pages/              # Landing · Home · Research · Coding · Pdf · News · Tool
│       ├── components/         # dock, sidebar, composer, model picker, markdown, pdf, ...
│       ├── hooks/              # useChat · useResearch · useCoding · useTheme · ...
│       ├── three/              # lõi phản ứng 3D của trang chủ
│       ├── config/             # registry tool, token theme, hiển thị event
│       ├── styles/             # CSS thuần + design token
│       └── test/               # Vitest suite
├── tests/                      # pytest suite của backend
├── supabase/                   # migration cho session store
├── data/                       # dữ liệu runtime (pdf đã upload, sandbox)
├── Dockerfile                  # image backend
├── Dockerfile.executor         # image sandbox chạy code
├── docker-compose.yml
├── pyproject.toml · uv.lock    # dependency Python
└── .env.example                # tham chiếu cấu hình đầy đủ
```

---

## 📄 Giấy phép

Dự án được duy trì bởi **Nhukiet**. Mọi đóng góp, báo lỗi và đề xuất tính năng đều
được hoan nghênh qua GitHub Issues / Pull Requests.
