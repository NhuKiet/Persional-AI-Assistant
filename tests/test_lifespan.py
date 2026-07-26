from fastapi.testclient import TestClient


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
