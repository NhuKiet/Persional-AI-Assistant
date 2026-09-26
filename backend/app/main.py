import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from psycopg import OperationalError

from backend.app.features.assistant_bubble.router import router as assistant_bubble_router
from backend.app.features.chat.router import router as chat_router
from backend.app.features.coding.router import router as coding_router
from backend.app.features.hmer.router import router as hmer_router
from backend.app.features.models.router import router as models_router
from backend.app.features.news.router import router as news_router
from backend.app.features.pdf.router import router as pdf_router
from backend.app.features.research.router import router as research_router
from backend.app.core.config import settings
from backend.app.core.csrf import RequireClientHeaderMiddleware
from backend.app.core.lifespan import lifespan
from backend.app.core import capabilities
from backend.app.shared.conversation_store import StorageUnavailableError


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


app = FastAPI(
    title="KiNg AI Backend",
    version="3.0.0",
    description="Research + Chat + Coding Agent + PDF Chat + News Digest",
    lifespan=lifespan,
)

# Added before CORS so CORS wraps it: the 403 still carries CORS headers and
# the frontend can read it. See core/csrf.py.
app.add_middleware(RequireClientHeaderMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    # Vite falls back to the next free port (5174, 5175, ...) whenever 5173 is
    # already taken by another dev server — an exact allowlist would silently
    # break CORS ("Failed to fetch" with no useful error) every time that
    # happens. A regex covering any localhost/127.0.0.1 port is safe here
    # because allow_credentials is False (no cookies/auth crossing origins).
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Added last so it runs first: a request whose Host isn't ours (DNS
# rebinding, or a LAN client hitting this machine's IP) is refused before
# CORS or any route sees it. See ALLOWED_HOSTS in core/config.py.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

app.include_router(research_router)
app.include_router(chat_router)
app.include_router(assistant_bubble_router)
app.include_router(coding_router)
app.include_router(pdf_router)
app.include_router(models_router)
app.include_router(hmer_router)
app.include_router(news_router)


# A dead database is an outage, not a crash. Left unhandled, psycopg's
# PoolTimeout / connection errors become a bare 500 from Starlette's
# outermost middleware — outside CORS, so the browser shows only a network
# error. Handled here, the 503 goes back through CORS with a readable reason.
# OperationalError covers PoolTimeout and refused connections, not SQL bugs.
@app.exception_handler(OperationalError)
@app.exception_handler(StorageUnavailableError)
async def storage_unavailable(request: Request, exc: Exception) -> JSONResponse:
    logger.warning("[STORAGE] %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Không kết nối được database — kiểm tra rồi thử lại.",
            "code": "storage_unavailable",
        },
    )


@app.get("/health")
async def health():
    """Liveness plus one honest field.

    Deliberately always 200: a load balancer probing this must not kill a
    process because an optional capability is degraded. The body says what is
    actually working; /health/capabilities says why.
    """
    return {"status": capabilities.snapshot()["status"], "version": "3.0.0"}


@app.get("/health/capabilities")
async def health_capabilities():
    return capabilities.snapshot()
