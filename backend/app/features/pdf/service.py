import asyncio
import logging
import threading
from collections.abc import AsyncIterator, Iterator

from backend.app.core.config import settings
from backend.app.core.llm import invoke_chat, stream_chat
from backend.app.shared.conversation_store import ConversationManager
from backend.app.features.pdf.context import build_multimodal_content, has_image_pin
from backend.app.features.pdf.processor import (
    MAP_OUTPUT_CHARS,
    REDUCE_INPUT_CHARS,
    PDFProcessor,
)
from backend.app.features.pdf.schemas import PDFChatRequest, PDFSummarizeRequest
from backend.app.shared.session_locks import KeyedLockRegistry, SessionBusyError

__all__ = ["PdfService", "SessionBusyError"]


logger = logging.getLogger(__name__)

# Shown when a document exceeds the full-summary scope (see processor.py's
# FULL_SUMMARY_MAX_PAGES/CHARS) — never silently summarize a truncated
# excerpt while claiming to have covered the whole document.
SCOPE_LIMIT_MESSAGE = (
    "Tài liệu này vượt giới hạn tóm tắt toàn bộ (tối đa 100 trang / 100.000 ký tự). "
    "Hãy chọn tóm tắt theo một khoảng trang cụ thể, hoặc đặt câu hỏi về nội dung bạn quan tâm — "
    "trợ lý vẫn tra cứu được nội dung liên quan trong toàn bộ tài liệu."
)


class PdfService:
    def __init__(self, processor: PDFProcessor | None = None, conversations: ConversationManager | None = None):
        self._processor = processor or PDFProcessor()
        self._conv_manager = conversations or ConversationManager(namespace="pdf")
        self._doc_cache: dict[str, object] = {}
        # Single-worker only — see backend/app/shared/session_locks.py.
        # Both chat and summarize mutate the same session_id, so they share
        # one registry: only one of the two may run at a time per session.
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

    def _get_doc(self, filename: str):
        if filename not in self._doc_cache:
            self._doc_cache[filename] = self._processor.extract(filename)
        return self._doc_cache[filename]

    def _stream_llm(
        self,
        messages: list[dict],
        system: str,
        provider: str | None = None,
        model: str | None = None,
    ) -> Iterator[str]:
        yield from stream_chat(messages, system=system, provider=provider, model=model)

    async def chat_events(self, request: PDFChatRequest, system: str) -> AsyncIterator[dict]:
        effective_provider = (request.provider or settings.DEFAULT_PROVIDER).lower()
        if has_image_pin(request.pins) and effective_provider == "ollama":
            yield {
                "type": "error",
                "message": (
                    "Model cục bộ (llama3) không đọc được ảnh — chọn Claude hoặc GPT-4o "
                    "ở ModelPicker để giải thích vùng ảnh."
                ),
            }
            return

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict] = asyncio.Queue()

        def run() -> None:
            try:
                document = self._get_doc(request.filename)
                context = self._processor.build_context(document, request.message)
                content = build_multimodal_content(request.message, context, request.pins)
                history = self._conv_manager.get_history(request.session_id)
                messages = [*history[-8:], {"role": "user", "content": content}]

                full_response = ""
                for token in self._stream_llm(
                    messages,
                    system,
                    provider=request.provider,
                    model=request.model,
                ):
                    full_response += token
                    loop.call_soon_threadsafe(queue.put_nowait, {"type": "token", "content": token})

                image_note = " [+ảnh khoanh vùng]" if has_image_pin(request.pins) else ""
                self._conv_manager.add_turn(
                    request.session_id, role="user", content=request.message + image_note
                )
                self._conv_manager.add_turn(
                    request.session_id, role="assistant", content=full_response
                )
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "done", "message": "ok"})
            except FileNotFoundError:
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {
                        "type": "error",
                        "message": f"File '{request.filename}' không tìm thấy. Upload lại nhé.",
                    },
                )
            except Exception as exc:
                logger.error("PDF chat error: %s", exc, exc_info=True)
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})

        threading.Thread(target=run, daemon=True).start()
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=300)
                yield event
                if event.get("type") in ("done", "error"):
                    break
            except asyncio.TimeoutError:
                yield {"type": "error", "message": "Timeout (5 phút)"}
                break

    def _map_summarize(self, chunk_text: str, request: PDFSummarizeRequest, system: str) -> str:
        """Map step: summarize one bounded chunk (<= MAP_CHUNK_CHARS) into at
        most MAP_OUTPUT_CHARS chars. Non-streaming — the caller runs this
        once per chunk before the streamed reduce step."""
        prompt = (
            f"Tóm tắt đoạn tài liệu sau trong tối đa {MAP_OUTPUT_CHARS} ký tự, "
            f"giữ lại các ý và số liệu quan trọng nhất:\n\n{chunk_text}"
        )
        summary = invoke_chat(prompt, system=system, provider=request.provider, model=request.model)
        return summary[:MAP_OUTPUT_CHARS]

    async def summarize_events(self, request: PDFSummarizeRequest, system: str) -> AsyncIterator[dict]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict] = asyncio.Queue()

        def run() -> None:
            try:
                document = self._get_doc(request.filename)

                if self._processor.exceeds_summary_scope(document):
                    loop.call_soon_threadsafe(queue.put_nowait, {
                        "type": "pdf.summary_scope_rejected",
                        "message": SCOPE_LIMIT_MESSAGE,
                    })
                    loop.call_soon_threadsafe(queue.put_nowait, {"type": "done", "message": "ok"})
                    return

                # Bounded map-reduce: summarize each chunk independently
                # (map), then fold the bounded set of map-summaries into one
                # final streamed summary (reduce).
                map_chunks = self._processor.map_chunks(document)
                map_summaries = [self._map_summarize(chunk, request, system) for chunk in map_chunks]
                reduce_input = "\n\n".join(map_summaries)[:REDUCE_INPUT_CHARS]
                logger.info(
                    "PDF summarize: %d map chunk(s), reduce input %d chars",
                    len(map_chunks), len(reduce_input),
                )

                messages = [{
                    "role": "user",
                    "content": (
                        "Tổng hợp các tóm tắt từng phần sau đây thành một bản tóm tắt "
                        f"mạch lạc, duy nhất cho toàn bộ tài liệu:\n\n{reduce_input}"
                    ),
                }]
                full_response = ""
                for token in self._stream_llm(
                    messages,
                    system,
                    provider=request.provider,
                    model=request.model,
                ):
                    full_response += token
                    loop.call_soon_threadsafe(queue.put_nowait, {"type": "token", "content": token})
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "done", "message": "ok"})
            except Exception as exc:
                logger.error("PDF summarize error: %s", exc, exc_info=True)
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})

        threading.Thread(target=run, daemon=True).start()
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=300)
                yield event
                if event.get("type") in ("done", "error"):
                    break
            except asyncio.TimeoutError:
                yield {"type": "error", "message": "Timeout"}
                break
