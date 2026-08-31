import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.features.assistant_bubble.router import router as assistant_bubble_router
from backend.app.features.chat.router import router as chat_router
from backend.app.features.coding.router import router as coding_router
from backend.app.features.models.router import router as models_router
from backend.app.features.news.router import router as news_router
from backend.app.features.pdf.router import router as pdf_router
from backend.app.features.research.router import router as research_router
from backend.app.core.lifespan import lifespan
from backend.app.core import capabilities


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


app = FastAPI(
    title="KiNg AI Backend",
    version="3.0.0",
    description="Research + Chat + Coding Agent + PDF Chat + News Digest",
    lifespan=lifespan,
)

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

app.include_router(research_router)
app.include_router(chat_router)
app.include_router(assistant_bubble_router)
app.include_router(coding_router)
app.include_router(pdf_router)
app.include_router(models_router)
app.include_router(news_router)


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
