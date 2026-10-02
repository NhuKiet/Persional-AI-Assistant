"""Prompt-injection hardening for RSS content fed into the summarizer LLM.

The implementation lives in backend/app/shared/untrusted.py, shared with
research and pdf — shared/ is where cross-feature code goes, so features
still don't import each other's internals (see
tests/test_feature_boundaries.py). This module keeps the old import path.
"""
from backend.app.shared.untrusted import UNTRUSTED_GUARD, frame_untrusted

__all__ = ["UNTRUSTED_GUARD", "frame_untrusted"]
