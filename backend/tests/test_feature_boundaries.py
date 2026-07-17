from pathlib import Path


def test_pdf_feature_uses_shared_conversation_store_not_chat_feature():
    service_source = (
        Path(__file__).resolve().parents[1]
        / "app"
        / "features"
        / "pdf"
        / "service.py"
    ).read_text(encoding="utf-8")

    assert "from backend.app.shared.conversation_store import ConversationManager" in service_source
    assert "backend.app.features.chat.conversation_store" not in service_source


def test_research_feature_does_not_import_legacy_tools_package():
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1] / "app" / "features" / "research"
    offenders = []
    for py in root.rglob("*.py"):
        text = py.read_text(encoding="utf-8")
        for line in text.splitlines():
            s = line.strip()
            if s.startswith(("import tools", "from tools")):
                offenders.append(f"{py.name}: {s}")
    assert not offenders, "Research imports legacy tools.*: " + "; ".join(offenders)
