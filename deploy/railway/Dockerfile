# KiNg on Railway — one container: nginx serves the built frontend on $PORT
# and proxies /api to uvicorn on 127.0.0.1:8000 (deploy/railway/start.sh).
# One service, one domain, same origin for the login cookie, and no private
# networking between two services to keep in sync.
#
# Differences from the docker-compose images (Dockerfile, frontend/Dockerfile):
# - No torch / transformers / FlagEmbedding. Only the cross-encoder reranker
#   and the handwriting model use them, and both are off on this host
#   (RERANK_ENABLED=false, no HMER_CHECKPOINT); every import of them is lazy,
#   so the app runs without them. tests/test_railway_deploy.py checks that.
# - The handwriting tool is hidden from the UI at build time (VITE_HMER=off).
# - Database migrations run at every start (tools/migrate.py, idempotent).
#
# Build context is the repository root. Railway picks this file through the
# RAILWAY_DOCKERFILE_PATH service variable; Dockerfile.dockerignore next to
# it replaces the root .dockerignore, which leaves frontend/ out.

FROM node:24-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_HMER=off
ENV VITE_HMER=$VITE_HMER
RUN npm run build

FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
# The locked versions, minus the packages only the two switched-off models
# need. --prune also drops whatever only they depended on (CUDA wheels and
# all), which is what takes the image from ~12 GB to a few hundred MB.
COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-emit-project \
        --prune torch --prune flagembedding --prune transformers \
        --prune tokenizers --prune safetensors --prune huggingface-hub \
        --prune sympy --prune networkx \
        -o /tmp/requirements.txt \
    && uv pip install --system --no-cache -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

COPY main.py ./
COPY backend/ backend/
COPY tools/migrate.py tools/
COPY supabase/migrations/ supabase/migrations/
COPY deploy/railway/ deploy/railway/
COPY frontend/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=frontend /app/dist /usr/share/nginx/html
# A Windows checkout may hand the script over with CRLF line endings.
RUN sed -i 's/\r$//' deploy/railway/start.sh && chmod +x deploy/railway/start.sh

# What this host has and lacks, as defaults; a Railway service variable with
# the same name overrides any of them. Empty OLLAMA_URL = no Ollama machine
# (core/llm.available_models). HTTPS always ends at Railway's edge.
ENV PYTHONUNBUFFERED=1 \
    OLLAMA_URL="" \
    DEFAULT_PROVIDER=openai \
    RERANK_ENABLED=false \
    HMER_CHECKPOINT="" \
    NEWS_ENABLED=false \
    COOKIE_SECURE=true
CMD ["deploy/railway/start.sh"]
