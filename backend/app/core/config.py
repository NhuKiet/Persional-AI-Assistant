"""core/settings.py — Nguồn config duy nhất cho KiNg.

Thay thế các os.getenv rải rác. Đọc từ .env (giữ nguyên tên biến hiện có).
"""
from __future__ import annotations

# This module is the canonical configuration home; ``core.settings`` re-exports it.

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_VALID_PROVIDERS = {"ollama", "anthropic", "openai"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── LLM / Ollama ────────────────────────────────────────────────
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3"
    LLM_NUM_GPU: int = 99
    LLM_TIMEOUT: int = 300

    # ── LLM providers (mới) ─────────────────────────────────────────
    DEFAULT_PROVIDER: str = "ollama"
    DEFAULT_MODEL: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str | None = None
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    # ── Chat ────────────────────────────────────────────────────────
    MAX_HISTORY: int = 20

    # ── Giới hạn tải / chi phí ──────────────────────────────────────
    # Chặn message quá dài (blow-up token/chi phí) và upload quá lớn.
    MAX_MESSAGE_CHARS: int = 24000
    MAX_UPLOAD_MB: int = 20

    # ── Embeddings + knowledge store ────────────────────────────────
    RERANKER_MODEL: str = "BAAI/bge-reranker-v2-m3"
    KNOWLEDGE_THRESHOLD: float = 0.65
    KNOWLEDGE_CHUNK_SIZE: int = 500
    KNOWLEDGE_OVERLAP: int = 50
    KNOWLEDGE_TOP_K: int = 40

    # ── Weaviate Cloud ──────────────────────────────────────────────
    WEAVIATE_URL: str | None = None
    WEAVIATE_API_KEY: str | None = None
    WEAVIATE_COLLECTION: str = "KnowledgeChunk"

    # ── Rerank ──────────────────────────────────────────────────────
    COHERE_API_KEY: str | None = None
    RERANK_ENABLED: bool = True
    RERANK_GATE_THRESHOLD: float = 0.5
    RERANK_CANDIDATES: int = 30

    # ── Research grounding ────────────────────────────────────────────
    RESEARCH_GROUNDING_ENABLED: bool = True

    # ── Search APIs ─────────────────────────────────────────────────
    TAVILY_API_KEY: str | None = None
    TAVILY_BOOST_BLOGS: bool = False
    GITHUB_TOKEN: str | None = None
    S2_API_KEY: str | None = None

    # ── Coding agent ────────────────────────────────────────────────
    CODE_TIMEOUT: int = 30
    MAX_OUTPUT_LEN: int = 8000
    MAX_DEBUG_ITER: int = 4
    ENABLE_TESTS: bool = False
    ENABLE_REVIEW: bool = False
    # Auto-install package thiếu bằng `pip install` vào MÔI TRƯỜNG MÁY CHỦ khi
    # code do LLM sinh báo ModuleNotFoundError. Tắt mặc định: đây là vector để
    # code sinh tự ý cài dependency (kể cả tên gói độc hại) vào env backend.
    # Chỉ bật khi executor đã chạy trong sandbox cách ly.
    ENABLE_AUTO_INSTALL: bool = False

    # ── Executor sandbox ────────────────────────────────────────────
    # "subprocess" (mặc định): chạy code trong tiến trình con của backend —
    #   nhanh, không cần Docker, nhưng KHÔNG cách ly filesystem/network.
    # "docker": mỗi lần chạy tạo một container ephemeral, --network none +
    #   giới hạn CPU/RAM/pids, chỉ mount thư mục sandbox. Cách ly thật sự.
    #   Cần Docker daemon chạy và đã build image EXECUTOR_IMAGE
    #   (xem Dockerfile.executor). Nếu chọn "docker" mà daemon không sẵn sàng,
    #   executor tự fallback về subprocess và ghi cảnh báo.
    EXECUTOR_MODE: str = "subprocess"
    EXECUTOR_IMAGE: str = "king-executor:latest"
    EXECUTOR_MEMORY: str = "512m"
    EXECUTOR_CPUS: str = "1.0"
    EXECUTOR_PIDS: int = 128
    # Tên biến môi trường (phân tách bằng dấu phẩy) muốn lộ THÊM cho code do
    # LLM sinh chạy trong sandbox. Mặc định rỗng: sandbox KHÔNG kế thừa secret
    # của server (xem _safe_env trong tools/code_executor.py). Chỉ thêm biến ở
    # đây nếu một tác vụ hợp lệ thật sự cần, ví dụ "MPLBACKEND".
    CODE_ENV_EXTRA: str = ""

    # ── PDF ─────────────────────────────────────────────────────────
    PDF_UPLOAD_DIR: str = "data/pdfs"
    PDF_CHUNK_SIZE: int = 800
    PDF_CHUNK_OVERLAP: int = 100
    PDF_MAX_CONTEXT: int = 6000

    @field_validator("DEFAULT_PROVIDER")
    @classmethod
    def _check_provider(cls, v: str) -> str:
        if v not in _VALID_PROVIDERS:
            raise ValueError(
                f"DEFAULT_PROVIDER '{v}' không hợp lệ. "
                f"Chọn một trong: {sorted(_VALID_PROVIDERS)}"
            )
        return v


settings = Settings()
