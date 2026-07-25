import asyncio
import logging
import threading
from collections.abc import AsyncIterator

from backend.app.core.llm import astream_chat
from backend.app.features.research.agent import ResearchAgent
from backend.app.features.research.schemas import DeepDiveRequest, ResearchRequest
from backend.app.features.research.security import frame_untrusted, UNTRUSTED_GUARD
from backend.app.shared.conversation_store import ConversationManager
from backend.app.shared.session_locks import KeyedLockRegistry, SessionBusyError

__all__ = ["ResearchService", "SessionBusyError"]

logger = logging.getLogger(__name__)


def _stringify_turn_content(content) -> str:
    """Turns can hold plain text (deep-dive Q&A) or the full research-result
    dict (main flow, so session restore can rebuild the UI) — flatten either
    shape into a short text usable as LLM conversation context."""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return content.get("summary_short") or content.get("summary_detailed") or ""
    return ""


def _text_history(history: list[dict]) -> list[dict]:
    out = []
    for h in history:
        text = _stringify_turn_content(h.get("content"))
        if text:
            out.append({"role": h.get("role", "user"), "content": text})
    return out


class ResearchService:
    def __init__(
        self,
        agent: ResearchAgent | None = None,
        conversations: ConversationManager | None = None,
    ):
        self._agent = agent or ResearchAgent()
        self._conv_manager = conversations or ConversationManager(namespace="research")
        # Single-worker only — see backend/app/shared/session_locks.py.
        self._locks = KeyedLockRegistry()

    def begin_session(self, session_id: str) -> threading.Lock:
        """Reserve exclusive mutation rights for a session for the lifetime of
        one stream. Raises SessionBusyError if another stream already holds it."""
        lock = self._locks.try_acquire(session_id)
        if lock is None:
            raise SessionBusyError(session_id)
        return lock

    def end_session(self, lock: threading.Lock) -> None:
        self._locks.release(lock)

    def get_history_with_revision(self, session_id: str) -> tuple[list[dict], int]:
        return self._conv_manager.get_history_with_revision(session_id)

    async def stream_events(self, req: ResearchRequest) -> AsyncIterator[dict]:
        loop = asyncio.get_event_loop()
        aqueue: asyncio.Queue = asyncio.Queue()
        query = req.query.strip()
        cancel_event = threading.Event()
        history = _text_history(self._conv_manager.get_history(req.session_id))

        def _run():
            try:
                for event in self._agent.run_streaming(
                    query, req.provider, req.model, cancel_event=cancel_event,
                    history=history,
                ):
                    loop.call_soon_threadsafe(aqueue.put_nowait, event)
            except Exception as e:  # noqa: BLE001 — surfaced as SSE error
                loop.call_soon_threadsafe(
                    aqueue.put_nowait, {"type": "error", "message": str(e)}
                )

        threading.Thread(target=_run, daemon=True).start()
        try:
            while True:
                try:
                    event = await asyncio.wait_for(aqueue.get(), timeout=1800)
                    yield event
                    if event.get("type") == "done":
                        self._conv_manager.add_turn(req.session_id, role="user", content=query)
                        self._conv_manager.add_turn(
                            req.session_id, role="assistant", content=event.get("data", {})
                        )
                        break
                    if event.get("type") == "error":
                        break
                except asyncio.TimeoutError:
                    yield {"type": "error", "message": "Research timed out (20 min)"}
                    break
        finally:
            cancel_event.set()   # client disconnect (GeneratorExit) hoặc kết thúc → dừng worker

    async def deep_dive_events(self, req: DeepDiveRequest, system: str) -> AsyncIterator[dict]:
        meta = req.source_meta or {}
        framed = frame_untrusted(req.source_content[:8000])
        context = (
            f"[{meta.get('source', '').upper()}] {meta.get('title', '')}\n"
            f"{meta.get('url', '')}\n\n{framed}"
        ).strip()

        # Contextual follow-up: fold in recent turns from this session (prior
        # deep-dive Q&A and/or the main research answer) so a question like
        # "so what about X" resolves against what was already discussed.
        history = _text_history(self._conv_manager.get_history(req.session_id))
        convo_block = ""
        if history:
            recent = history[-6:]
            convo = "\n".join(
                f"{'User' if h['role'] == 'user' else 'Assistant'}: {h['content'][:300]}"
                for h in recent
            )
            convo_block = f"Previous conversation:\n{convo}\n\n"

        user_prompt = (
            f"{UNTRUSTED_GUARD}\n\n{convo_block}"
            f"Source:\n{context}\n\nQuestion: {req.question.strip()}"
        )
        try:
            messages = [{"role": "user", "content": user_prompt}]
            full_response = ""
            async for token in astream_chat(
                messages, system=system, provider=req.provider, model=req.model,
            ):
                full_response += token
                yield {"type": "token", "content": token}
            self._conv_manager.add_turn(req.session_id, role="user", content=req.question.strip())
            self._conv_manager.add_turn(req.session_id, role="assistant", content=full_response)
            yield {"type": "done", "message": "ok"}
        except Exception as e:  # noqa: BLE001
            logger.error("Deep dive error: %s", e, exc_info=True)
            yield {"type": "error", "message": str(e)}

    def clear_cache(self) -> None:
        self._agent.clear_cache()
