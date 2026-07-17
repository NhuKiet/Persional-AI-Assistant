# Backend Root Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all legacy Python/API/test modules from the repository root so `backend/` is the only backend source and test boundary.

**Architecture:** Keep `backend.app.main` as the repository-root import path during this phase, but make every production and test import target `backend.app.*` directly. Move the root pytest suite into `backend/tests/`, then delete compatibility adapters only after an import scan proves they have no consumers.

**Tech Stack:** Python 3.11, FastAPI, pytest, PowerShell, Git

## Global Constraints

- Preserve every current HTTP method, URL, status code, response body and SSE event.
- Preserve all environment variable names and runtime data paths.
- Features may import `backend.app.core` and `backend.app.shared`; features must not import other features.
- Do not change Research algorithms, frontend behavior or Vietnamese encoding in this plan.
- Run commands from the repository root unless a step says otherwise.

---

### Task 1: Lock the clean-root requirement with a failing structure test

**Files:**
- Create: `backend/tests/test_project_layout.py`
- Test: `backend/tests/test_project_layout.py`

**Interfaces:**
- Consumes: repository root resolved from `Path(__file__).parents[2]`.
- Produces: `test_python_backend_lives_only_under_backend`, the final structural gate for this plan.

- [ ] **Step 1: Add the failing layout test**

```python
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_python_backend_lives_only_under_backend():
    forbidden_files = {
        "main.py",
        "api_chat.py",
        "api_coding.py",
        "api_models.py",
        "api_pdf.py",
        "api_research.py",
    }
    forbidden_directories = {"core", "tools", "tests"}

    assert not forbidden_files.intersection(path.name for path in ROOT.glob("*.py"))
    assert not forbidden_directories.intersection(
        path.name for path in ROOT.iterdir() if path.is_dir()
    )
```

- [ ] **Step 2: Run the test and record the expected failure**

Run: `python -m pytest backend/tests/test_project_layout.py -q`

Expected: FAIL listing the current root `main.py`, `api_*.py`, `core`, `tools` or `tests` entries.

- [ ] **Step 3: Commit the red test**

```powershell
git add backend/tests/test_project_layout.py
git commit -m "test: require a clean backend project root"
```

### Task 2: Consolidate backend tests under one tree

**Files:**
- Move: `tests/contract/*` to `backend/tests/contract/`
- Move: `tests/test_api_models.py`, `tests/test_config_migration.py`, `tests/test_llm.py`, `tests/test_settings.py` to `backend/tests/core/`
- Move: `tests/test_chat_wiring.py`, `tests/test_conversation_compatibility.py` to `backend/tests/features/chat/`
- Move: `tests/test_coding_wiring.py`, `tests/test_executor_docker.py` to `backend/tests/features/coding/`
- Move: `tests/test_pdf_context.py`, `tests/test_pdf_wiring.py` to `backend/tests/features/pdf/`
- Move: all remaining `tests/test_*.py` Research tests to `backend/tests/features/research/`
- Move: `tests/test_security.py` to `backend/tests/shared/test_security.py`
- Modify: every moved test import
- Delete: `tests/__init__.py`

**Interfaces:**
- Consumes: public symbols from `backend.app.core`, `backend.app.shared` and `backend.app.features`.
- Produces: one pytest discovery root at `backend/tests/` with no compatibility-module imports.

- [ ] **Step 1: Move the contract and core tests**

```powershell
New-Item -ItemType Directory -Force backend/tests/contract | Out-Null
git mv tests/contract/test_api_contracts.py backend/tests/contract/test_api_contracts.py
git mv tests/contract/test_research_contract.py backend/tests/contract/test_research_contract.py
git mv tests/test_api_models.py backend/tests/core/test_api_models.py
git mv tests/test_config_migration.py backend/tests/core/test_config.py
git mv tests/test_llm.py backend/tests/core/test_llm.py
git mv tests/test_settings.py backend/tests/core/test_settings.py
```

- [ ] **Step 2: Move feature and shared tests**

```powershell
git mv tests/test_chat_wiring.py backend/tests/features/chat/test_router.py
git mv tests/test_conversation_compatibility.py backend/tests/features/chat/test_conversation_store.py
git mv tests/test_coding_wiring.py backend/tests/features/coding/test_router.py
git mv tests/test_executor_docker.py backend/tests/features/coding/test_execution.py
git mv tests/test_pdf_context.py backend/tests/features/pdf/test_context.py
git mv tests/test_pdf_wiring.py backend/tests/features/pdf/test_router.py
git mv tests/test_security.py backend/tests/shared/test_security.py
git mv tests/test_chunking.py backend/tests/features/research/test_chunking.py
git mv tests/test_embeddings.py backend/tests/features/research/test_embeddings.py
git mv tests/test_grounding_llm.py backend/tests/features/research/test_grounding_llm.py
git mv tests/test_grounding_pure.py backend/tests/features/research/test_grounding_pure.py
git mv tests/test_knowledge_store.py backend/tests/features/research/test_knowledge_store.py
git mv tests/test_models_grounding.py backend/tests/features/research/test_models_grounding.py
git mv tests/test_ranking_signals.py backend/tests/features/research/test_ranking_signals.py
git mv tests/test_reranker.py backend/tests/features/research/test_reranker.py
git mv tests/test_research_wiring.py backend/tests/features/research/test_router.py
git mv tests/test_synthesize_grounded.py backend/tests/features/research/test_synthesis.py
```

- [ ] **Step 3: Replace compatibility imports with canonical imports**

Use these exact mappings throughout `backend/tests/`:

```python
# Router imports
from backend.app.features.chat.router import router as chat_router
from backend.app.features.coding.router import router as coding_router
from backend.app.features.models.router import router as models_router
from backend.app.features.pdf.router import router as pdf_router
from backend.app.features.research.router import router as research_router

# Core and helper imports
from backend.app.core.config import Settings, settings
from backend.app.core.llm import available_models, get_llm
from backend.app.features.pdf.context import build_multimodal_content, has_image_pin
from backend.app.features.coding.execution import CodeExecutor
```

Delete assertions that compare a root adapter object with a feature object. Keep assertions about endpoint inventory, response payloads and SSE events.

- [ ] **Step 4: Remove empty legacy test package files**

```powershell
git rm tests/contract/__init__.py tests/__init__.py
```

Do not delete `tests/` manually; Git removes it when its last tracked file moves.

- [ ] **Step 5: Run the consolidated suite**

Run: `python -m pytest backend/tests -q --ignore=backend/tests/test_project_layout.py`

Expected: PASS with the same number of collected functional tests as the pre-move baseline, excluding only compatibility-identity assertions intentionally removed.

- [ ] **Step 6: Prove tests no longer import legacy modules**

Run:

```powershell
rg -n '(^|\s)(from|import)\s+(api_|core\.|tools\.)' backend/tests
```

Expected: no matches.

- [ ] **Step 7: Commit the unified test tree**

```powershell
git add -A backend/tests tests
git commit -m "refactor: consolidate backend tests"
```

### Task 3: Remove backend compatibility modules

**Files:**
- Delete: `main.py`
- Delete: `api_chat.py`, `api_coding.py`, `api_models.py`, `api_pdf.py`, `api_research.py`
- Delete: `core/llm.py`, `core/pdf_context.py`, `core/settings.py`
- Delete: `tools/code_executor.py`, `tools/coding_agent.py`, `tools/conversation.py`, `tools/pdf_processor.py`, `tools/__init__.py`
- Modify: `backend/tests/core/test_config_and_llm_imports.py`
- Test: `backend/tests/test_project_layout.py`

**Interfaces:**
- Consumes: canonical modules already used by production code and Task 2 tests.
- Produces: `backend.app.main:app` as the only repository-root backend import path.

- [ ] **Step 1: Change the legacy import test into a canonical import test**

Replace `backend/tests/core/test_config_and_llm_imports.py` with:

```python
from backend.app.core.config import Settings
from backend.app.core.llm import available_models
from backend.app.main import app


def test_canonical_backend_imports_are_available():
    assert Settings is not None
    assert callable(available_models)
    assert app.title == "KiNg AI Backend"
```

- [ ] **Step 2: Scan all tracked source for legacy consumers**

Run:

```powershell
rg -n '(^|\s)(from|import)\s+(api_|core\.|tools\.)|from main import' backend frontend .github Dockerfile docker-compose.yml
```

Expected: no production matches. If a match remains, change it to its exact `backend.app.*` owner and rerun the focused test before continuing.

- [ ] **Step 3: Delete the adapters**

```powershell
git rm main.py api_chat.py api_coding.py api_models.py api_pdf.py api_research.py
git rm core/llm.py core/pdf_context.py core/settings.py
git rm tools/code_executor.py tools/coding_agent.py tools/conversation.py tools/pdf_processor.py tools/__init__.py
```

- [ ] **Step 4: Run the structure and complete backend suites**

Run: `python -m pytest backend/tests/test_project_layout.py -q`

Expected: PASS.

Run: `python -m pytest backend/tests -q`

Expected: PASS.

- [ ] **Step 5: Verify the production app imports from its canonical path**

Run:

```powershell
python -c "from backend.app.main import app; print(app.title)"
```

Expected: prints `KiNg AI Backend` and exits 0.

- [ ] **Step 6: Commit the clean backend boundary**

```powershell
git add backend main.py api_chat.py api_coding.py api_models.py api_pdf.py api_research.py core tools
git commit -m "refactor: remove backend root adapters"
```

### Task 4: Final backend boundary review

**Files:**
- Test: `backend/tests/test_feature_boundaries.py`
- Test: `backend/tests/test_project_layout.py`

**Interfaces:**
- Consumes: final backend source and tests.
- Produces: verified backend cleanup ready for deployment-path migration.

- [ ] **Step 1: Check feature dependency direction**

Run: `python -m pytest backend/tests/test_feature_boundaries.py -q`

Expected: PASS.

- [ ] **Step 2: Check no forbidden root paths remain**

Run:

```powershell
Get-ChildItem -Force | Where-Object { $_.Name -match '^(api_.*\.py|main\.py|core|tools|tests)$' }
```

Expected: no output.

- [ ] **Step 3: Run final backend verification**

Run: `python -m pytest backend/tests -q`

Expected: PASS with zero failures.
