"""Streams stay alive across silent stretches (backend/app/shared/sse.py).

A proxy in front of the app drops a response that sends nothing for a while —
Cloudflare after 100 s — and several streams legitimately go quiet for longer
than that while a model writes a long section or summarises a PDF. An SSE
comment line every few seconds keeps the connection open; the browser's
parser ignores it (frontend/src/lib/sse.ts).
"""
import asyncio

import pytest

from backend.app.shared import sse as sse_mod
from backend.app.shared.sse import KEEPALIVE, LeasedStreamingResponse, sse, with_keepalive


async def _collect(stream) -> list[str]:
    return [chunk async for chunk in stream]


def _events(chunks: list[str]) -> list[str]:
    return [chunk for chunk in chunks if chunk != KEEPALIVE]


def test_a_silent_stretch_is_filled_with_comments_and_no_event_is_lost():
    async def quiet_then_answer():
        yield sse({"n": 1})
        await asyncio.sleep(0.25)  # a model thinking
        yield sse({"n": 2})

    chunks = asyncio.run(_collect(with_keepalive(quiet_then_answer(), interval=0.05)))

    assert _events(chunks) == [sse({"n": 1}), sse({"n": 2})]
    assert chunks.count(KEEPALIVE) >= 2
    assert chunks[0] == sse({"n": 1}) and chunks[-1] == sse({"n": 2})  # only in the gap
    assert KEEPALIVE.startswith(":") and KEEPALIVE.endswith("\n\n")   # an SSE comment


def test_a_stream_that_keeps_talking_gets_nothing_added():
    async def chatty():
        for n in range(5):
            yield sse({"n": n})

    chunks = asyncio.run(_collect(with_keepalive(chatty(), interval=5)))

    assert chunks == [sse({"n": n}) for n in range(5)]


def test_waiting_does_not_interrupt_the_work_the_stream_is_waiting_on():
    # asyncio.wait_for would cancel the pending step on every tick; the step
    # must run to completion exactly once however many comments go out.
    started = []

    async def one_slow_step():
        started.append(1)
        await asyncio.sleep(0.2)
        yield sse({"done": True})

    chunks = asyncio.run(_collect(with_keepalive(one_slow_step(), interval=0.03)))

    assert started == [1]
    assert _events(chunks) == [sse({"done": True})]


@pytest.mark.parametrize("leave_while", ["waiting", "between_events"])
def test_a_reader_that_leaves_lets_the_stream_clean_up(leave_while):
    cleaned = []

    async def stream():
        try:
            yield sse({"n": 1})
            await asyncio.sleep(30 if leave_while == "waiting" else 0)
            yield sse({"n": 2})
            await asyncio.sleep(30)
        finally:
            cleaned.append(True)

    async def read_a_little():
        wrapped = with_keepalive(stream(), interval=0.02)
        seen = []
        async for chunk in wrapped:
            seen.append(chunk)
            if (leave_while == "waiting" and chunk == KEEPALIVE) or chunk == sse({"n": 2}):
                break
        await wrapped.aclose()  # what Starlette does when the client disconnects
        return seen

    asyncio.run(read_a_little())

    assert cleaned == [True]


def test_an_error_in_the_stream_still_reaches_the_response():
    async def broken():
        yield sse({"n": 1})
        raise RuntimeError("model died")

    with pytest.raises(RuntimeError, match="model died"):
        asyncio.run(_collect(with_keepalive(broken(), interval=5)))


def test_every_leased_stream_gets_keepalive_and_still_releases_its_lease(monkeypatch):
    monkeypatch.setattr(sse_mod, "KEEPALIVE_SECONDS", 0.03)
    released = []

    class Lease:
        def release(self):
            released.append(True)

    async def quiet():
        yield sse({"n": 1})
        await asyncio.sleep(0.15)
        yield sse({"n": 2})

    async def run() -> list[bytes]:
        response = LeasedStreamingResponse(quiet(), lease=Lease(), media_type="text/event-stream")
        sent: list[bytes] = []

        async def receive():
            await asyncio.sleep(3600)

        async def send(message):
            if message["type"] == "http.response.body":
                sent.append(message.get("body", b""))

        await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
        return sent

    body = b"".join(asyncio.run(run())).decode()

    assert body.count(KEEPALIVE) >= 2
    assert body.replace(KEEPALIVE, "") == sse({"n": 1}) + sse({"n": 2})
    assert released == [True]
