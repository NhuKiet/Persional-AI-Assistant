# Deploy-ready project structure

## Mục tiêu

Tổ chức lại KiNg thành một monorepo dễ đọc với hai ứng dụng độc lập: backend
FastAPI và frontend React. Thư mục gốc chỉ giữ cấu hình điều phối toàn dự án;
không còn chứa mã Python, API adapter hay test backend.

Đợt thay đổi này chỉ cải tổ cấu trúc. Các URL, payload, SSE event, hành vi UI,
biến môi trường và dữ liệu runtime hiện có phải được giữ nguyên.

## Cấu trúc đích

```text
personal-ai-assistant/
├── backend/
│   ├── app/
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── docs/
├── scripts/
│   ├── dev.ps1
│   └── test.ps1
├── data/
├── .github/workflows/
├── .env.example
├── .gitignore
├── docker-compose.yml
└── README.md
```

`data/` là nơi chứa PDF, SQLite, sandbox và artifact runtime. Nội dung runtime
không được commit. `.env` tiếp tục nằm ở gốc để Docker Compose và các script phát
triển dùng chung một nguồn cấu hình.

## Backend

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── llm.py
│   │   └── lifespan.py
│   ├── shared/
│   │   ├── sse.py
│   │   ├── errors.py
│   │   ├── files.py
│   │   └── conversation_store.py
│   └── features/
│       ├── chat/
│       │   ├── router.py
│       │   ├── schemas.py
│       │   ├── service.py
│       │   ├── repository.py
│       │   └── prompts.py
│       ├── coding/
│       │   ├── router.py
│       │   ├── schemas.py
│       │   ├── service.py
│       │   ├── execution.py
│       │   ├── artifacts.py
│       │   ├── uploads.py
│       │   └── prompts.py
│       ├── pdf/
│       │   ├── router.py
│       │   ├── schemas.py
│       │   ├── service.py
│       │   ├── repository.py
│       │   ├── processor.py
│       │   └── context.py
│       ├── research/
│       │   ├── router.py
│       │   ├── schemas.py
│       │   ├── service.py
│       │   ├── agent.py
│       │   ├── search/
│       │   ├── retrieval/
│       │   └── synthesis/
│       └── models/
│           └── router.py
├── tests/
│   ├── contract/
│   ├── core/
│   ├── shared/
│   └── features/
├── requirements.txt
└── Dockerfile
```

### Trách nhiệm

- `app/main.py` chỉ tạo FastAPI app, middleware, lifespan và đăng ký router.
- `router.py` xử lý HTTP/SSE boundary và chuyển dữ liệu sang service.
- `schemas.py` chứa request, response và validation của feature.
- `service.py` điều phối nghiệp vụ, không phụ thuộc trực tiếp vào FastAPI.
- `repository.py` hoặc module storage tương đương sở hữu thao tác lưu trữ.
- `core/` chứa cấu hình nền tảng chỉ backend dùng.
- `shared/` chỉ chứa capability được ít nhất hai feature sử dụng.

Các file `api_chat.py`, `api_coding.py`, `api_models.py`, `api_pdf.py`,
`api_research.py`, root `main.py`, root `core/` và root `tools/` sẽ bị loại bỏ sau
khi mọi importer và test đã chuyển sang package mới. Không giữ compatibility
adapter ở trạng thái cuối.

## Frontend

```text
frontend/src/
├── app/
│   ├── App.tsx
│   ├── router.tsx
│   └── styles/
├── features/
│   ├── landing/
│   ├── chat/
│   ├── tool-mode/
│   ├── coding/
│   ├── pdf/
│   └── research/
├── shared/
│   ├── api/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   ├── types/
│   └── styles/
└── assets/
```

Mỗi feature sở hữu page, component, hook, API adapter, type và style chỉ phục vụ
feature đó. `shared/` không trở thành nơi chứa đồ chưa biết đặt ở đâu: một module
chỉ được đưa vào đây khi có ít nhất hai feature thực sự dùng chung.

CSS vẫn có một entry point có thứ tự import rõ ràng trong `app/styles/`. Đợt
refactor không đổi CSS class, route, lazy-loading boundary hay giao diện.

## Quy tắc phụ thuộc

```text
Backend:  app.main -> features -> shared/core
Frontend: app      -> features -> shared
```

- Feature không import trực tiếp feature khác.
- `shared/` và `core/` không import feature.
- Backend router gọi service; service không gọi router.
- Frontend page ghép component/hook của chính feature và module shared.
- Thành phần dùng chung mới chỉ được tách ra sau khi có consumer thứ hai.

## Luồng API và lỗi

Frontend tiếp tục gọi các endpoint `/api/*` hiện có. `backend/app/main.py` đăng
ký router trực tiếp từ từng feature. Router validate input, service xử lý nghiệp
vụ, repository hoặc integration module thực hiện I/O, rồi router trả JSON hoặc
SSE với contract hiện tại.

Lỗi validation, status code, SSE error event và thông báo hiện có phải được khóa
bằng contract test trước khi di chuyển. Refactor không được che lỗi bằng catch-all
mới hoặc thay đổi cấu trúc response. Các thao tác file tiếp tục chống path
traversal và giữ giới hạn upload hiện tại.

## Chạy local và deploy

- Backend local: `cd backend` rồi chạy `python -m uvicorn app.main:app --reload`.
- Frontend local: `cd frontend` rồi chạy `npm run dev`.
- Toàn stack: chạy `docker compose up --build` từ thư mục gốc.

Backend image dùng `backend/` làm build context, copy `requirements.txt` từ cùng
thư mục và chạy `uvicorn app.main:app`. Frontend image tiếp tục dùng
`frontend/` làm build context. Compose mount `./data` vào backend để giữ dữ liệu
runtime.

CI backend đặt working directory là `backend`, cài
`backend/requirements.txt` và chạy `python -m pytest -q`. CI frontend giữ working
directory là `frontend`, chạy typecheck, unit test và production build.

Hai script PowerShell ở root cung cấp lệnh ngắn cho người mới. Chúng chỉ điều
phối các lệnh chuẩn phía trên, không chứa logic build riêng.

## Chiến lược migration

1. Ghi nhận baseline của backend test, frontend test, typecheck và build.
2. Chuyển toàn bộ test backend về `backend/tests/` và sửa import theo package
   chính thức.
3. Chuyển phần còn dùng trong root `core/` và `tools/` vào `backend/app/core`,
   `backend/app/shared` hoặc feature sở hữu nó.
4. Chứng minh không còn production/test importer rồi xóa từng compatibility
   adapter `api_*.py` và root `main.py`.
5. Tổ chức frontend theo feature, giữ nguyên public route và thứ tự CSS.
6. Di chuyển backend dependency/Dockerfile, cập nhật Compose và CI.
7. Thêm script phát triển, cập nhật README và chạy toàn bộ verification.

Mỗi bước phải nhỏ, có test trước và có thể review độc lập. Không trộn cải tiến
thuật toán Research, thay đổi UI hoặc sửa encoding hàng loạt vào refactor này.

## Kiểm thử

- Contract test kiểm tra toàn bộ method, path, status và SSE payload hiện có.
- Backend unit/service test nằm cạnh nhóm feature tương ứng dưới
  `backend/tests/features/`.
- Frontend feature test được đặt cạnh feature; `frontend/src/test/` chỉ giữ
  setup và test helper dùng chung.
- Test bảo mật giữ kiểm tra path traversal, upload limit và code executor.
- Frontend route/smoke test xác nhận các URL và lazy route vẫn hoạt động.
- `npm run typecheck`, `npm run test` và `npm run build` phải thành công.
- `docker compose config` và backend import/health check phải thành công.

## Tiêu chí hoàn thành

- Không còn file Python, package `core/`, package `tools/` hoặc test backend ở
  repository root.
- Mỗi API implementation chỉ tồn tại trong feature package sở hữu nó.
- Không còn compatibility import từ `api_*.py`, root `core` hoặc root `tools`.
- Backend và frontend có lệnh local, Docker build context và CI boundary riêng.
- Public API, SSE, route frontend, cấu hình và dữ liệu runtime không đổi.
- README mô tả đúng cây thư mục và lệnh chạy sau migration.
- Toàn bộ backend/frontend test, typecheck, build và Compose validation vượt qua.
