import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _no_capability_probe(monkeypatch):
    """The real lifespan starts a daemon thread that probes embeddings and
    Weaviate. Under TestClient that means unit tests make billed API calls and
    a live network connection, and the thread outlives the test to write into
    the module-global capability registry — poisoning whichever test happens to
    sort after this file."""
    import backend.app.core.lifespan as lifespan_mod

    monkeypatch.setattr(
        lifespan_mod.threading, "Thread",
        lambda *args, **kwargs: type("_NoThread", (), {"start": lambda self: None})(),
    )


def test_lifespan_closes_store_on_shutdown(monkeypatch):
    import backend.app.shared.conversation_store as conv_mod
    from backend.app.main import app

    closed = []

    class _Recorder:
        def cleanup_old(self, max_age_days: int = 30) -> int:
            return 0

        def close(self) -> None:
            closed.append(True)

    monkeypatch.setattr(conv_mod, "_store", _Recorder())

    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert closed == []  # not closed yet — app is still running

    assert closed == [True]  # closed exactly once, after the app shut down


def test_lifespan_starts_and_cancels_news_background_task(monkeypatch):
    import backend.app.features.news.scheduler as news_scheduler_mod
    import backend.app.features.news.store as news_store_mod
    import backend.app.shared.conversation_store as conv_mod
    from backend.app.main import app

    class _Recorder:
        def cleanup_old(self, max_age_days: int = 30) -> int:
            return 0

        def close(self) -> None:
            pass

    monkeypatch.setattr(conv_mod, "_store", _Recorder())

    news_closed = []

    class _NewsRecorder:
        def prune_older_than(self, days: int = 30) -> int:
            return 0

        def close(self) -> None:
            news_closed.append(True)

    monkeypatch.setattr(news_store_mod, "_store", _NewsRecorder())

    task_started = []

    def fake_start_background_task():
        import asyncio

        async def _noop_forever():
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                raise

        t = asyncio.ensure_future(_noop_forever())
        task_started.append(t)
        return t

    monkeypatch.setattr(news_scheduler_mod, "start_background_task", fake_start_background_task)

    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert task_started, "background task should have been started"
        assert not task_started[0].done()

    assert task_started[0].cancelled() or task_started[0].done()
    assert news_closed == [True]


def test_lifespan_skips_news_task_when_storage_unconfigured(monkeypatch):
    import backend.app.features.news.scheduler as news_scheduler_mod
    import backend.app.features.news.store as news_store_mod
    import backend.app.shared.conversation_store as conv_mod
    from backend.app.main import app

    class _Recorder:
        def cleanup_old(self, max_age_days: int = 30) -> int:
            return 0

        def close(self) -> None:
            pass

    monkeypatch.setattr(conv_mod, "_store", _Recorder())

    class _NewsRecorder:
        def prune_older_than(self, days: int = 30) -> int:
            return 0

        def close(self) -> None:
            pass

    monkeypatch.setattr(news_store_mod, "_store", _NewsRecorder())
    monkeypatch.setattr(news_scheduler_mod, "start_background_task", lambda: None)

    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
