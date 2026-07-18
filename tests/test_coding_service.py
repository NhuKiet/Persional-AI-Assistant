from backend.app.features.coding.artifacts import ARTIFACT_EXTS
from backend.app.features.coding.execution import detect_missing_packages, install_packages
from backend.app.features.coding.prompts import REVIEW_PROMPT, SYSTEM_PROMPT
from backend.app.features.coding.schemas import CodingRequest
import backend.app.features.coding.service as coding_service
from backend.app.features.coding.service import CodingAgent, CodingService, _build_plot_hint


def test_coding_request_keeps_existing_public_fields():
    request = CodingRequest(
        message="make a chart",
        session_id="s1",
        chat_only=True,
        uploaded_files=[{"name": "data.csv"}],
        provider="openai",
        model="gpt-4o",
    )

    assert request.session_id == "s1"
    assert request.chat_only is True
    assert request.uploaded_files == [{"name": "data.csv"}]
    assert request.provider == "openai"
    assert request.model == "gpt-4o"


def test_coding_service_uses_injected_agent_factory():
    factory_calls = []

    def factory(**kwargs):
        factory_calls.append(kwargs)
        return object()

    service = CodingService(agent_factory=factory)

    assert service is not None
    assert factory_calls == [{}]


def test_coding_prompts_and_plot_hint_keep_original_literals():
    assert "NEVER call plt.show() — headless environment" in SYSTEM_PROMPT
    assert "safety — max 3 points" in REVIEW_PROMPT
    assert _build_plot_hint("vẽ biểu đồ") == (
        "IMPORTANT — visualization task:\n"
        "  import matplotlib\n"
        "  matplotlib.use('Agg')\n"
        "  import matplotlib.pyplot as plt\n"
        "  # ... create figure ...\n"
        "  plt.tight_layout()\n"
        "  plt.savefig('plot.png', dpi=150, bbox_inches='tight')\n"
        "  print('Plot saved to plot.png')\n"
        "NEVER use plt.show()\n"
    )


def test_coding_agent_keeps_user_visible_vietnamese_events(monkeypatch, tmp_path):
    calls = 0

    def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        yield "[]" if calls == 1 else "not a code block"

    monkeypatch.setattr(coding_service, "_stream_ollama", fake_stream)
    agent = CodingAgent()
    monkeypatch.setattr(coding_service, "_session_sandbox", lambda _session_id: tmp_path)

    events = list(agent.run("viết biểu đồ", [], "s1"))

    assert events[0] == {"type": "thinking", "message": "Đang lên kế hoạch..."}
    assert events[3] == {"type": "generating", "message": "Đang viết code..."}
    assert events[-1] == {
        "type": "error",
        "message": "LLM không tạo ra code block. Thử diễn đạt lại.",
    }
