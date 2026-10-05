"""Nguồn config duy nhất cho KiNg.

Thay thế các os.getenv rải rác. Đọc từ .env (giữ nguyên tên biến hiện có).
"""
from __future__ import annotations

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_VALID_PROVIDERS = {"ollama", "anthropic", "openai"}
_VALID_EXECUTOR_MODES = {"docker"}
# Hosts that only this machine can reach. "testserver" is the Host header of
# Starlette's TestClient — never a real public name.
_THIS_MACHINE = {"localhost", "127.0.0.1", "::1", "[::1]", "testserver"}
_VALID_HMER_DEVICES = {"auto", "cuda", "cpu"}


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
    # Giây chờ tối đa cho MỖI thao tác mạng của một lời gọi LLM/embeddings
    # (kết nối, hay khoảng lặng giữa hai gói khi stream) — không phải tổng
    # thời gian trả lời, nên câu trả lời dài vẫn stream được. Không đặt thì các
    # SDK chờ tới ~10 phút rồi còn tự thử lại, giữ nguyên khoá phiên suốt lúc đó.
    LLM_TIMEOUT: float = 120
    # Số lần tự thử lại khi lỗi mạng/quá hạn (SDK mặc định 2).
    LLM_MAX_RETRIES: int = 1

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
    # auto | cuda | cpu. Máy 4GB VRAM có cả HMER thì đặt "cpu": reranker
    # (~1.9GB) và SwinCoMER (~1.2GB) cùng lên GPU thì Windows không báo OOM mà
    # đẩy VRAM sang RAM — một lần nhận dạng từ 6 s thành hơn 3 phút.
    RERANKER_DEVICE: str = "auto"
    KNOWLEDGE_THRESHOLD: float = 0.65
    KNOWLEDGE_CHUNK_SIZE: int = 500
    KNOWLEDGE_OVERLAP: int = 50
    KNOWLEDGE_TOP_K: int = 40
    KNOWLEDGE_CANDIDATE_THRESHOLD: float = 0.65
    # Giây tối đa chờ một lần tra knowledge store trước khi bỏ qua nó: đây là
    # cache, tra ấm mất dưới 1s — chậm hơn mức này thì tìm mới nhanh hơn.
    KNOWLEDGE_QUERY_TIMEOUT: float = 6.0
    KNOWLEDGE_COVERAGE_MIN: float = 0.6
    KNOWLEDGE_TTL_VOLATILE_DAYS: int = 7
    KNOWLEDGE_TTL_STABLE_DAYS: int = 180
    KNOWLEDGE_TTL_DEFAULT_DAYS: int = 30

    # ── Weaviate Cloud ──────────────────────────────────────────────
    WEAVIATE_URL: str | None = None
    WEAVIATE_API_KEY: str | None = None
    WEAVIATE_COLLECTION: str = "KnowledgeChunk"

    # ── Supabase (sessions/messages) ───────────────────────────────
    SUPABASE_DB_URL: str | None = None

    # ── Rerank ──────────────────────────────────────────────────────
    COHERE_API_KEY: str | None = None
    RERANK_ENABLED: bool = True
    RERANK_GATE_THRESHOLD: float = 0.5
    RERANK_CANDIDATES: int = 30

    # ── Research grounding ────────────────────────────────────────────
    RESEARCH_GROUNDING_ENABLED: bool = True
    RESEARCH_MAX_ITERATIONS: int = 1
    RESEARCH_SUFFICIENCY_ENABLED: bool = True
    RESEARCH_JUDGE_TIMEOUT_SECONDS: int = 20

    # ── Search APIs ─────────────────────────────────────────────────
    TAVILY_API_KEY: str | None = None
    TAVILY_BOOST_BLOGS: bool = False
    S2_API_KEY: str | None = None

    # ── News digest ──────────────────────────────────────────────────
    NEWS_REFRESH_INTERVAL_SECONDS: int = 6 * 3600
    NEWS_MANUAL_COOLDOWN_SECONDS: int = 60
    NEWS_MAX_ITEMS_PER_FEED: int = 20
    NEWS_MAX_ITEM_AGE_DAYS: int = 14
    NEWS_MAX_NEW_ITEMS_PER_RUN: int = 100
    NEWS_DESCRIPTION_TRUNCATE_CHARS: int = 1800

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
    # Docker là chế độ DUY NHẤT được hỗ trợ: mỗi lần chạy tạo một container
    # ephemeral, --network none + --read-only + --cap-drop ALL +
    # no-new-privileges + giới hạn CPU/RAM/pids, chỉ mount thư mục sandbox.
    # Cần Docker daemon chạy và đã build image EXECUTOR_IMAGE (xem
    # Dockerfile.executor). Nếu daemon không sẵn sàng, executor trả về một
    # ExecutionResult typed với unavailable=True — KHÔNG bao giờ chạy code
    # do LLM sinh trực tiếp trên host bằng subprocess. Bất kỳ giá trị nào
    # khác "docker" bị từ chối ngay khi load settings.
    EXECUTOR_MODE: str = "docker"
    EXECUTOR_IMAGE: str = "king-executor:latest"
    EXECUTOR_MEMORY: str = "512m"
    EXECUTOR_CPUS: str = "1.0"
    EXECUTOR_PIDS: int = 128

    # ── Mạng ────────────────────────────────────────────────────────
    # Danh sách Host header được phục vụ (TrustedHostMiddleware), phân tách
    # bằng dấu phẩy. Chặn DNS rebinding: trang evil.com trỏ DNS về 127.0.0.1
    # thì trình duyệt coi mọi request là cùng origin, nhưng vẫn gửi
    # "Host: evil.com". Deploy sau domain riêng thì thêm domain đó vào đây;
    # "*.example.com" khớp mọi subdomain.
    ALLOWED_HOSTS: str = "localhost,127.0.0.1"

    # Giới hạn số request tốn tiền/GPU mỗi client mỗi phút (core/rate_limit.py).
    # Research nặng hơn hẳn (một request = nhiều search API + nhiều lượt LLM)
    # nên có ngưỡng riêng, thấp hơn.
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 30
    RATE_LIMIT_RESEARCH_PER_MINUTE: int = 6
    # Đoán mật khẩu: vài lần mỗi phút là đủ cho người gõ nhầm.
    RATE_LIMIT_LOGIN_PER_MINUTE: int = 5

    # ── Đăng nhập (core/auth.py) ────────────────────────────────────
    # Đặt OWNER_PASSWORD thì chủ đăng nhập để dùng mọi thứ; ai khác là khách.
    # Không đặt = chế độ mở như trước — chỉ được phép khi ALLOWED_HOSTS là máy
    # này (xem _require_password_when_exposed).
    OWNER_PASSWORD: str | None = None
    # Khoá ký cookie phiên. Không đặt thì suy ra từ OWNER_PASSWORD — đổi mật
    # khẩu là mọi phiên cũ hết hiệu lực.
    SESSION_SECRET: str | None = None
    SESSION_DAYS: int = 30
    # True khi chạy sau HTTPS: trình duyệt chỉ gửi cookie qua kết nối mã hoá.
    # Bắt buộc khi ALLOWED_HOSTS có host ngoài máy này
    # (xem _require_secure_cookie_when_exposed).
    COOKIE_SECURE: bool = False
    # Khách dùng thử: Chat, PDF, công thức viết tay — mỗi IP GUEST_DAILY_LIMIT
    # lượt trong 24 giờ, không lưu lịch sử, dùng model GUEST_PROVIDER/MODEL
    # (trống = model mặc định của server).
    GUEST_ENABLED: bool = True
    GUEST_DAILY_LIMIT: int = 10
    GUEST_PROVIDER: str | None = None
    GUEST_MODEL: str | None = None
    GUEST_MAX_UPLOAD_MB: int = 5

    @property
    def allowed_hosts(self) -> list[str]:
        return [h.strip() for h in self.ALLOWED_HOSTS.split(",") if h.strip()]

    @property
    def auth_enabled(self) -> bool:
        return bool(self.OWNER_PASSWORD)

    # ── Assistant bubble (bridge sang ai-agent, dự án riêng) ──────────
    # ai-agent chạy bridge_server.py trên máy này; xem README của ai-agent.
    BRIDGE_URL: str = "http://127.0.0.1:8766"
    BRIDGE_TOKEN: str | None = None

    # ── PDF ─────────────────────────────────────────────────────────
    PDF_UPLOAD_DIR: str = "data/pdfs"
    PDF_CHUNK_SIZE: int = 800
    PDF_CHUNK_OVERLAP: int = 100
    PDF_MAX_CONTEXT: int = 6000

    # ── HMER (nhận dạng công thức toán viết tay) ────────────────────
    # Checkpoint SwinCoMER không nằm trong repo nào (quá lớn, và .gitignore
    # của dự án capstone chặn *.ckpt). Chưa trỏ tới file hợp lệ thì capability
    # "hmer" báo disabled và /api/hmer/recognize trả 503 — app vẫn chạy bình
    # thường, các tính năng khác không bị ảnh hưởng.
    HMER_CHECKPOINT: str | None = None
    HMER_UPLOAD_DIR: str = "data/hmer"
    HMER_DEVICE: str = "auto"
    HMER_MAX_IMAGE_MB: int = 10

    @field_validator("HMER_DEVICE")
    @classmethod
    def _check_hmer_device(cls, v: str) -> str:
        if v not in _VALID_HMER_DEVICES:
            raise ValueError(
                f"HMER_DEVICE '{v}' không hợp lệ. "
                f"Chọn một trong: {sorted(_VALID_HMER_DEVICES)}"
            )
        return v

    @field_validator("RERANKER_DEVICE")
    @classmethod
    def _check_reranker_device(cls, v: str) -> str:
        if v not in _VALID_HMER_DEVICES:
            raise ValueError(
                f"RERANKER_DEVICE '{v}' không hợp lệ. "
                f"Chọn một trong: {sorted(_VALID_HMER_DEVICES)}"
            )
        return v

    @field_validator("LLM_TIMEOUT")
    @classmethod
    def _check_llm_timeout(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("LLM_TIMEOUT phải > 0 giây.")
        return v

    @field_validator("LLM_MAX_RETRIES")
    @classmethod
    def _check_llm_retries(cls, v: int) -> int:
        if v < 0:
            raise ValueError("LLM_MAX_RETRIES phải >= 0.")
        return v

    @field_validator("RATE_LIMIT_PER_MINUTE", "RATE_LIMIT_RESEARCH_PER_MINUTE", "RATE_LIMIT_LOGIN_PER_MINUTE")
    @classmethod
    def _check_rate_limit(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Rate limit phải >= 1 (muốn tắt thì đặt RATE_LIMIT_ENABLED=false).")
        return v

    @field_validator("OWNER_PASSWORD")
    @classmethod
    def _check_owner_password(cls, v: str | None) -> str | None:
        if v is not None and v != "" and len(v) < 10:
            raise ValueError("OWNER_PASSWORD quá ngắn — cần ít nhất 10 ký tự.")
        return v or None

    @field_validator("GUEST_DAILY_LIMIT", "GUEST_MAX_UPLOAD_MB", "SESSION_DAYS")
    @classmethod
    def _check_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Giá trị phải >= 1.")
        return v

    @model_validator(mode="after")
    def _require_password_when_exposed(self) -> "Settings":
        """Without OWNER_PASSWORD every tool is open to whoever reaches the
        server. That is how the app has always run on one machine; it must
        not be how it runs on a public host."""
        remote = [h for h in self.allowed_hosts if h not in _THIS_MACHINE]
        if remote and not self.auth_enabled:
            raise ValueError(
                f"ALLOWED_HOSTS mở ra ngoài ({', '.join(remote)}) nhưng chưa đặt OWNER_PASSWORD — "
                "ai vào được cũng dùng được mọi công cụ. Đặt OWNER_PASSWORD trong .env."
            )
        return self

    @model_validator(mode="after")
    def _require_secure_cookie_when_exposed(self) -> "Settings":
        """Beyond this machine the login must travel over HTTPS: without the
        Secure flag the browser sends the session cookie — and the form sends
        the password — in the clear to anyone on the network path."""
        remote = [h for h in self.allowed_hosts if h not in _THIS_MACHINE]
        if remote and not self.COOKIE_SECURE:
            raise ValueError(
                f"ALLOWED_HOSTS mở ra ngoài ({', '.join(remote)}) nhưng COOKIE_SECURE chưa bật — "
                "mật khẩu và cookie đăng nhập sẽ đi qua HTTP không mã hoá. "
                "Đặt HTTPS phía trước rồi COOKIE_SECURE=true trong .env."
            )
        return self

    @field_validator("ALLOWED_HOSTS")
    @classmethod
    def _check_allowed_hosts(cls, v: str) -> str:
        hosts = [h.strip() for h in v.split(",") if h.strip()]
        if not hosts:
            raise ValueError("ALLOWED_HOSTS rỗng — mọi request sẽ bị từ chối.")
        for host in hosts:
            wildcard_ok = host == "*" or (host.startswith("*.") and len(host) > 2)
            if "*" in host and not (wildcard_ok and "*" not in host[1:]):
                raise ValueError(
                    f"ALLOWED_HOSTS '{host}' không hợp lệ. Wildcard chỉ dạng '*.example.com'."
                )
        return v

    @field_validator("DEFAULT_PROVIDER")
    @classmethod
    def _check_provider(cls, v: str) -> str:
        if v not in _VALID_PROVIDERS:
            raise ValueError(
                f"DEFAULT_PROVIDER '{v}' không hợp lệ. "
                f"Chọn một trong: {sorted(_VALID_PROVIDERS)}"
            )
        return v

    @field_validator("EXECUTOR_MODE")
    @classmethod
    def _check_executor_mode(cls, v: str) -> str:
        if v not in _VALID_EXECUTOR_MODES:
            raise ValueError(
                f"EXECUTOR_MODE '{v}' không hợp lệ — chỉ hỗ trợ chạy code "
                f"trong Docker cách ly. Chọn một trong: {sorted(_VALID_EXECUTOR_MODES)}"
            )
        return v


settings = Settings()
