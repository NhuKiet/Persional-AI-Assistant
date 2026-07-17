import asyncio
import logging
import threading
from collections.abc import AsyncIterator, Iterator

from backend.app.core.config import settings
from backend.app.core.llm import stream_chat
from backend.app.shared.conversation_store import ConversationManager
from backend.app.features.pdf.context import build_multimodal_content, has_image_pin
from backend.app.features.pdf.processor import PDFProcessor
from backend.app.features.pdf.schemas import PDFChatRequest, PDFSummarizeRequest


logger = logging.getLogger(__name__)


class PdfService:
    def __init__(self, processor: PDFProcessor | None = None, conversations: ConversationManager | None = None):
        self._processor = processor or PDFProcessor()
        self._conv_manager = conversations or ConversationManager(namespace="pdf")
        self._doc_cache: dict[str, object] = {}

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

    async def summarize_events(self, request: PDFSummarizeRequest, system: str) -> AsyncIterator[dict]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict] = asyncio.Queue()

        def run() -> None:
            try:
                document = self._get_doc(request.filename)
                context = self._processor.summary_context(document)
                messages = [{"role": "user", "content": f"Hãy tóm tắt tài liệu sau:\n\n{context}"}]
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
