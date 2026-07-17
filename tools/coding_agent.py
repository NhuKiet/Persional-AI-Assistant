"""Compatibility exports for the Coding feature implementation."""

from backend.app.features.coding.prompts import CHAT_SYSTEM, CODE_PROMPT, DEBUG_PROMPT, PLAN_PROMPT, REVIEW_PROMPT, SYSTEM_PROMPT, TEST_PROMPT
from backend.app.features.coding.service import (
    ARTIFACT_EXTS,
    ENABLE_AUTO_INSTALL,
    ENABLE_REVIEW,
    ENABLE_TESTS,
    MAX_DEBUG_ITER,
    CodingAgent,
    _build_file_context,
    _build_plot_hint,
    _call_ollama,
    _collect_artifacts,
    _detect_missing_packages,
    _extract_all_files,
    _extract_code,
    _history_str,
    _inject_preamble,
    _install_packages,
    _sandbox_snapshot,
    _session_sandbox,
    _stream_ollama,
)

__all__ = [
    "CHAT_SYSTEM", "CODE_PROMPT", "DEBUG_PROMPT", "PLAN_PROMPT", "REVIEW_PROMPT", "SYSTEM_PROMPT", "TEST_PROMPT",
    "ENABLE_AUTO_INSTALL", "ENABLE_REVIEW", "ENABLE_TESTS", "MAX_DEBUG_ITER", "CodingAgent", "ARTIFACT_EXTS",
    "_build_file_context", "_build_plot_hint", "_call_ollama", "_collect_artifacts", "_extract_all_files", "_extract_code",
    "_history_str", "_inject_preamble", "_install_packages", "_detect_missing_packages", "_sandbox_snapshot", "_session_sandbox", "_stream_ollama",
]
