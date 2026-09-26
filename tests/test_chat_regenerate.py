"""Regenerate and edit-last in chat: `replace_last` answers the latest user
message again without the previous exchange in the context, then overwrites
that exchange. The overwrite happens only once the new answer exists, so a
failed LLM call leaves the history exactly as it was."""
import asyncio

import pytest

import backend.app.shared.conversation_store as conv_mod
from backend.app.features.chat.schemas import ChatRequest
from backend.app.features.chat.service import ChatService
from backend.app.shared.conversation_store import ConversationManager
from tests.fake_session_store import FakeSessionStore


def _turns(*pairs):
    return [{"role": role, "content": content} for role, content in pairs]


@pytest.fixture
def mgr(monkeypatch):
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
    return ConversationManager()


@pytest.fixture
def llm(monkeypatch):
    """Records the messages each LLM call receives; answers with `reply`."""
    calls = []
    state = {"reply": "trả lời mới", "fail": False}

    async def fake_astream(messages, **_kwargs):
        calls.append([dict(m) for m in messages])
        if state["fail"]:
            raise RuntimeError("provider down")
        yield state["reply"]

    monkeypatch.setattr(conv_mod, "astream_chat", fake_astream)
    return calls, state


def _run(mgr, **request):
    async def collect():
        return [
            e async for e in ChatService(conversations=mgr).stream(
                ChatRequest(session_id="s1", **request)
            )
        ]

    return asyncio.run(collect())


def test_replace_last_is_off_by_default():
    assert ChatRequest(message="hi").replace_last is False


def test_edit_answers_without_the_old_exchange_and_overwrites_it(mgr, llm):
    calls, _ = llm
    mgr.add_turns("s1", [("user", "u1"), ("assistant", "a1"), ("user", "u2"), ("assistant", "a2")])

    events = _run(mgr, message="u2 đã sửa", replace_last=True)

    assert events == [{"type": "token", "content": "trả lời mới"}]
    assert calls[-1] == _turns(("user", "u1"), ("assistant", "a1"), ("user", "u2 đã sửa"))
    assert mgr.get_history("s1") == _turns(
        ("user", "u1"), ("assistant", "a1"), ("user", "u2 đã sửa"), ("assistant", "trả lời mới"),
    )


def test_regenerate_resends_the_same_question(mgr, llm):
    calls, _ = llm
    mgr.add_turns("s1", [("user", "u1"), ("assistant", "a1")])

    _run(mgr, message="u1", replace_last=True)

    assert calls[-1] == _turns(("user", "u1"))
    assert mgr.get_history("s1") == _turns(("user", "u1"), ("assistant", "trả lời mới"))


def test_failed_regenerate_keeps_the_previous_exchange(mgr, llm):
    _, state = llm
    state["fail"] = True
    mgr.add_turns("s1", [("user", "u1"), ("assistant", "a1")])

    with pytest.raises(RuntimeError, match="provider down"):
        _run(mgr, message="u1", replace_last=True)

    assert mgr.get_history("s1") == _turns(("user", "u1"), ("assistant", "a1"))


def test_a_dangling_user_turn_is_replaced_too(mgr, llm):
    calls, _ = llm
    mgr.add_turns("s1", [("user", "u1"), ("assistant", "a1"), ("user", "u2")])

    _run(mgr, message="u2 lại", replace_last=True)

    assert calls[-1] == _turns(("user", "u1"), ("assistant", "a1"), ("user", "u2 lại"))
    assert mgr.get_history("s1")[-2:] == _turns(("user", "u2 lại"), ("assistant", "trả lời mới"))


def test_replace_last_on_an_empty_session_is_a_normal_turn(mgr, llm):
    _run(mgr, message="xin chào", replace_last=True)

    assert mgr.get_history("s1") == _turns(("user", "xin chào"), ("assistant", "trả lời mới"))


def test_without_replace_last_the_turn_is_appended(mgr, llm):
    mgr.add_turns("s1", [("user", "u1"), ("assistant", "a1")])

    _run(mgr, message="u2")

    assert [m["content"] for m in mgr.get_history("s1")] == ["u1", "a1", "u2", "trả lời mới"]
