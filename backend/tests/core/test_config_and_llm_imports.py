import ast
from pathlib import Path

from backend.app.core.config import Settings as NewSettings
from backend.app.core.llm import available_models as new_available_models
from core.llm import available_models as old_available_models
from core.settings import Settings as OldSettings


_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_TASK_3_CORE_CONSUMERS = (
    "api_chat.py",
    "api_coding.py",
    "api_models.py",
    "api_pdf.py",
    "api_research.py",
    "tools/code_executor.py",
    "tools/coding_agent.py",
    "tools/conversation.py",
    "tools/pdf_processor.py",
    "backend/app/features/research/embeddings.py",
    "backend/app/features/research/knowledge_store.py",
    "backend/app/features/research/reranker.py",
    "backend/app/features/research/agent.py",
    "backend/app/features/research/synthesizer.py",
    "backend/app/features/research/search/academic.py",
    "backend/app/features/research/search/community.py",
    "backend/app/features/research/search/query.py",
    "backend/app/features/research/search/web.py",
)


def test_task_3_production_consumers_use_canonical_core_imports():
    legacy_imports = []
    for relative_path in _TASK_3_CORE_CONSUMERS:
        module = ast.parse((_REPOSITORY_ROOT / relative_path).read_text(encoding="utf-8"))
        for node in ast.walk(module):
            if isinstance(node, ast.ImportFrom) and node.module in {"core.settings", "core.llm"}:
                legacy_imports.append(f"{relative_path}:{node.lineno} ({node.module})")

    assert not legacy_imports, "Legacy core imports remain: " + ", ".join(legacy_imports)


def test_settings_compatibility_adapter_reexports_new_type():
    assert OldSettings is NewSettings


def test_llm_compatibility_adapter_reexports_new_callable():
    assert old_available_models is new_available_models
