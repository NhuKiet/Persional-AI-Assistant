import asyncio
import backend.app.features.research.service as service_mod
from backend.app.features.research.schemas import ResearchRequest


def test_stream_events_yields_done_with_contract_keys(monkeypatch):
    """ResearchService.stream_events phải phát 'done' với đúng 10 khóa data,
    bọc agent.run_streaming (fake) — không chạm mạng/LLM."""
    DONE = {
        "query": "q", "summary_short": "", "summary_medium": "",
        "summary_detailed": "", "key_points": [], "comparison_table": [],
        "chart_data": None, "papers": [], "references": [],
        "follow_up_questions": [],
    }

    class _FakeAgent:
        def run_streaming(self, query, provider=None, model=None):
            yield {"type": "source_done", "source": "web", "count": 1}
            yield {"type": "done", "data": DONE}

    svc = service_mod.ResearchService(agent=_FakeAgent())

    async def _collect():
        return [ev async for ev in svc.stream_events(ResearchRequest(query="q"))]

    events = asyncio.run(_collect())
    done = [e for e in events if e.get("type") == "done"]
    assert len(done) == 1
    assert set(done[0]["data"]) == set(DONE)
