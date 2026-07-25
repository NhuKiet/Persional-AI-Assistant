import asyncio
import backend.app.features.research.service as service_mod
from backend.app.features.research.schemas import ResearchRequest

from backend.app.features.coding.schemas import CodingRequest
from backend.app.features.coding.service import CodingService


def test_stream_events_sets_cancel_event_on_generator_close():
    """Đóng async generator giữa chừng (client disconnect) → cancel_event của agent được set."""
    seen = {}

    class _FakeAgent:
        def run_streaming(self, query, provider=None, model=None, cancel_event=None, history=None):
            seen["cancel_event"] = cancel_event
            # phát nhiều event để có thể đóng giữa chừng
            for i in range(100):
                yield {"type": "status", "message": f"step {i}", "source": "x"}

    svc = service_mod.ResearchService(agent=_FakeAgent())

    async def _drive():
        gen = svc.stream_events(ResearchRequest(query="q"))
        first = await gen.__anext__()           # nhận 1 event rồi bỏ đi (disconnect)
        assert first["type"] == "status"
        await gen.aclose()                       # mô phỏng client disconnect
        # cho event loop chạy các callback threadsafe
        await asyncio.sleep(0.05)
        return seen["cancel_event"]

    ce = asyncio.run(_drive())
    assert ce is not None
    assert ce.is_set()                            # finally đã set


def test_coding_stream_sets_cancel_event_on_generator_close():
    """Client disconnect mid-stream (SSE generator closed) must propagate a
    cancel signal into the coding agent run, not just abort the HTTP
    response — otherwise the abandoned agent run keeps burning LLM/executor
    work server-side after the client gave up."""
    seen = {}

    class _FakeAgent:
        def chat(self, *_a, **_k):
            return iter([])

        def run(self, message, history, session_id, uploaded_files=None, provider=None, model=None, cancel_event=None):
            seen["cancel_event"] = cancel_event
            for i in range(100):
                yield {"type": "code_token", "content": str(i)}

    svc = CodingService(agent_factory=lambda **_k: _FakeAgent())

    async def _drive():
        gen = svc.stream(CodingRequest(message="hi", session_id="s1"))
        first = await gen.__anext__()
        assert first["type"] == "code_token"
        await gen.aclose()
        await asyncio.sleep(0.05)
        return seen["cancel_event"]

    ce = asyncio.run(_drive())
    assert ce is not None
    assert ce.is_set()
