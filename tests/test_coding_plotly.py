"""Interactive charts from the coding agent: generated code writes a Plotly
figure as JSON (`*.plotly.json` — data and layout, no script), the backend
collects and serves it as plain JSON, and the page draws it with plotly.js.
Any other .json the code writes stays an ordinary file, not an artifact.
"""
import pytest
from fastapi.testclient import TestClient

from backend.app.core.csrf import CLIENT_HEADER
from backend.app.features.coding import artifacts
from backend.app.features.coding.service import _build_plot_hint


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(artifacts, "SANDBOX_DIR", tmp_path)
    session = tmp_path / "s1"
    session.mkdir()
    return session


def test_a_plotly_figure_is_collected_but_other_json_is_not(sandbox):
    (sandbox / "chart.plotly.json").write_text('{"data": [], "layout": {}}')
    (sandbox / "results.json").write_text("{}")
    (sandbox / "plot.png").write_bytes(b"\x89PNG")

    found = artifacts.ArtifactService.collect(set(), sandbox, "s1")

    assert found == ["s1/chart.plotly.json", "s1/plot.png"]


def test_a_plotly_figure_is_served_as_inert_json(sandbox):
    from main import app

    (sandbox / "chart.plotly.json").write_text('{"data": [{"type": "bar", "y": [1, 2]}], "layout": {}}')
    (sandbox / "results.json").write_text("{}")
    client = TestClient(app, headers={CLIENT_HEADER: "test"})

    chart = client.get("/api/coding/artifact/s1/chart.plotly.json")
    assert chart.status_code == 200
    assert chart.headers["content-type"].startswith("application/json")
    assert chart.headers["x-content-type-options"] == "nosniff"
    assert chart.json()["data"][0]["type"] == "bar"

    assert client.get("/api/coding/artifact/s1/results.json").status_code == 400


def test_the_plot_hint_asks_for_an_interactive_plotly_figure():
    hint = _build_plot_hint("vẽ biểu đồ doanh thu")

    assert "plotly" in hint
    assert "fig.write_json('chart.plotly.json')" in hint
    assert "fig.show()" in hint and "NEVER" in hint
    assert _build_plot_hint("tính tổng hai số") == ""
