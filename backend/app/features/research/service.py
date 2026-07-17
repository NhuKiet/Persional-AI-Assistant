import asyncio
import logging
import threading
from collections.abc import AsyncIterator

from backend.app.core.llm import astream_chat
from backend.app.features.research.agent import ResearchAgent
from backend.app.features.research.schemas import DeepDiveRequest, ResearchRequest

logger = logging.getLogger(__name__)


class ResearchService:
    def __init__(self, agent: ResearchAgent | None = None):
        self._agent = agent or ResearchAgent()

    async def stream_events(self, req: ResearchRequest) -> AsyncIterator[dict]:
        loop = asyncio.get_event_loop()
        aqueue: asyncio.Queue = asyncio.Queue()
        query = req.query.strip()

        def _run():
            try:
                for event in self._agent.run_streaming(query, req.provider, req.model):
                    loop.call_soon_threadsafe(aqueue.put_nowait, event)
            except Exception as e:  # noqa: BLE001 — surfaced as SSE error
                loop.call_soon_threadsafe(
                    aqueue.put_nowait, {"type": "error", "message": str(e)}
                )

        threading.Thread(target=_run, daemon=True).start()
        while True:
            try:
                event = await asyncio.wait_for(aqueue.get(), timeout=1800)
                yield event
                if event.get("type") in ("done", "error"):
                    break
            except asyncio.TimeoutError:
                yield {"type": "error", "message": "Research timed out (20 min)"}
                break

    async def deep_dive_events(self, req: DeepDiveRequest, system: str) -> AsyncIterator[dict]:
        meta = req.source_meta or {}
        context = (
            f"[{meta.get('source', '').upper()}] {meta.get('title', '')}\n"
            f"{meta.get('url', '')}\n\n{req.source_content[:8000]}"
        ).strip()
        user_prompt = f"Source:\n{context}\n\nQuestion: {req.question.strip()}"
        try:
            messages = [{"role": "user", "content": user_prompt}]
            async for token in astream_chat(
                messages, system=system, provider=req.provider, model=req.model,
            ):
                yield {"type": "token", "content": token}
            yield {"type": "done", "message": "ok"}
        except Exception as e:  # noqa: BLE001
            logger.error("Deep dive error: %s", e, exc_info=True)
            yield {"type": "error", "message": str(e)}

    def clear_cache(self) -> None:
        self._agent.clear_cache()
