import asyncio
from datetime import datetime, timezone

import pytest

from backend.app.features.news import summarizer
from backend.app.features.news.models import NewsItem


def _item(n: int) -> NewsItem:
    return NewsItem(
        url=f"https://example.com/{n}", title=f"Title {n}", description_raw=f"Description {n}",
        source="Test Source", topic="research",
        published_at=datetime(2026, 7, 27, tzinfo=timezone.utc),
        fetched_at=datetime(2026, 7, 28, tzinfo=timezone.utc),
    )


def test_happy_path_fills_vi_fields_from_llm(monkeypatch):
    def fake_invoke_chat(prompt, system="", provider=None, model=None, **kw):
        return '[{"id": 0, "title_vi": "Tiêu đề 0", "summary_vi": "Tóm tắt 0"}]'

    monkeypatch.setattr(summarizer, "invoke_chat", fake_invoke_chat)
    items = asyncio.run(summarizer.summarize_new_items([_item(0)]))
    assert items[0].title_vi == "Tiêu đề 0"
    assert items[0].summary_vi == "Tóm tắt 0"


def test_missing_id_in_response_falls_back_for_that_item_only(monkeypatch):
    def fake_invoke_chat(prompt, system="", provider=None, model=None, **kw):
        # Only id=0 answered; id=1 missing from the response entirely.
        return '[{"id": 0, "title_vi": "Tiêu đề 0", "summary_vi": "Tóm tắt 0"}]'

    monkeypatch.setattr(summarizer, "invoke_chat", fake_invoke_chat)
    items = asyncio.run(summarizer.summarize_new_items([_item(0), _item(1)]))
    assert items[0].title_vi == "Tiêu đề 0"
    assert items[1].title_vi == "Title 1"          # fallback to original
    assert items[1].summary_vi == "Description 1"   # fallback to raw description


def test_duplicate_id_in_response_keeps_first_ignores_rest(monkeypatch):
    def fake_invoke_chat(prompt, system="", provider=None, model=None, **kw):
        return (
            '[{"id": 0, "title_vi": "First", "summary_vi": "First summary"}, '
            '{"id": 0, "title_vi": "Second", "summary_vi": "Second summary"}]'
        )

    monkeypatch.setattr(summarizer, "invoke_chat", fake_invoke_chat)
    items = asyncio.run(summarizer.summarize_new_items([_item(0)]))
    assert items[0].title_vi == "First"


def test_unknown_id_in_response_is_ignored(monkeypatch):
    def fake_invoke_chat(prompt, system="", provider=None, model=None, **kw):
        return '[{"id": 99, "title_vi": "Ghost", "summary_vi": "Ghost summary"}]'

    monkeypatch.setattr(summarizer, "invoke_chat", fake_invoke_chat)
    items = asyncio.run(summarizer.summarize_new_items([_item(0)]))
    assert items[0].title_vi == "Title 0"  # fallback — id 99 doesn't match anything


def test_total_parse_failure_falls_back_for_every_item_in_batch(monkeypatch):
    def fake_invoke_chat(prompt, system="", provider=None, model=None, **kw):
        return "this is not json at all"

    monkeypatch.setattr(summarizer, "invoke_chat", fake_invoke_chat)
    items = asyncio.run(summarizer.summarize_new_items([_item(0), _item(1)]))
    assert items[0].title_vi == "Title 0"
    assert items[1].title_vi == "Title 1"


def test_llm_exception_falls_back_for_every_item_in_batch(monkeypatch):
    def raising_invoke_chat(*a, **kw):
        raise RuntimeError("LLM unreachable")

    monkeypatch.setattr(summarizer, "invoke_chat", raising_invoke_chat)
    items = asyncio.run(summarizer.summarize_new_items([_item(0)]))
    assert items[0].title_vi == "Title 0"
    assert items[0].summary_vi == "Description 0"


def test_empty_input_returns_empty_list_without_calling_llm(monkeypatch):
    def fail_if_called(*a, **kw):
        raise AssertionError("should not be called for empty input")

    monkeypatch.setattr(summarizer, "invoke_chat", fail_if_called)
    assert asyncio.run(summarizer.summarize_new_items([])) == []


def test_batches_larger_than_batch_size_split_into_multiple_llm_calls(monkeypatch):
    calls = []

    def fake_invoke_chat(prompt, system="", provider=None, model=None, **kw):
        calls.append(prompt)
        return "[]"  # every item falls back — irrelevant to this test

    monkeypatch.setattr(summarizer, "invoke_chat", fake_invoke_chat)
    monkeypatch.setattr(summarizer, "_BATCH_SIZE", 2)
    items = asyncio.run(summarizer.summarize_new_items([_item(i) for i in range(5)]))
    assert len(calls) == 3  # 2 + 2 + 1
    assert len(items) == 5
