# Backend image — FastAPI + coding/research/pdf pipelines.
# Ảnh khá lớn vì FlagEmbedding kéo theo torch; đây là đánh đổi có chủ đích để
# giữ một requirements.txt duy nhất (xem docs/IMPROVEMENT_PLAN nếu muốn tách nhẹ).
FROM python:3.11-slim

# build-essential: vài dep (torch/FlagEmbedding, PyMuPDF) cần trình biên dịch.
# curl: dùng cho HEALTHCHECK bên dưới.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cài dep ở layer riêng để cache: đổi code không phải cài lại torch.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# .dockerignore đã loại .env, data/, .git, frontend/… nên COPY này không nuốt secret.
COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
