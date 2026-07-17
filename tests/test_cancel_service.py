import asyncio
import backend.app.features.research.service as service_mod
from backend.app.features.research.schemas import ResearchRequest


def test_stream_events_sets_cancel_event_on_generator_close():
    """Đóng async generator giữa chừng (client disconnect) → cancel_event của agent được set."""
    seen = {}

    class _FakeAgent:
        def run_streaming(self, query, provider=None, model=None, cancel_event=None):
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
