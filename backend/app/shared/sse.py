import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any, Protocol

from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

# A proxy in front of the app drops a response that sends nothing for a while
# (Cloudflare: 100 s), and a stream can legitimately stay quiet for longer —
# a model writing a long section, a PDF being summarised. An SSE comment line
# is ignored by the browser's parser (frontend/src/lib/sse.ts) and is enough
# to keep the connection open.
KEEPALIVE_SECONDS = 20.0
KEEPALIVE = ": keep-alive\n\n"


def sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def with_keepalive(body: AsyncIterator[str], interval: float | None = None) -> AsyncIterator[str]:
    """`body`, plus a KEEPALIVE comment each time it has been silent for `interval` seconds."""
    interval = KEEPALIVE_SECONDS if interval is None else interval
    iterator = body.__aiter__()
    step: asyncio.Future | None = None
    try:
        while True:
            if step is None:
                step = asyncio.ensure_future(iterator.__anext__())
            # asyncio.wait, not wait_for: a timeout must leave the step running.
            # wait_for would cancel it, and with it whatever the stream is in
            # the middle of — the model call, the turn being saved.
            done, _ = await asyncio.wait({step}, timeout=interval)
            if not done:
                yield KEEPALIVE
                continue
            finished, step = step, None
            try:
                chunk = finished.result()
            except StopAsyncIteration:
                return
            yield chunk
    finally:
        # The reader left (or the stream failed): stop the step it was waiting
        # on, then close the stream so its own `finally` blocks run.
        if step is not None and not step.done():
            step.cancel()
            try:
                await step
            except (asyncio.CancelledError, StopAsyncIteration, Exception):
                pass
        close = getattr(iterator, "aclose", None)
        if close is not None:
            await close()


class _Lease(Protocol):
    def release(self) -> None: ...


class LeasedStreamingResponse(StreamingResponse):
    """A stream that holds a session lease (shared/session_locks.py) and
    releases it however the response ends. Every stream of the app goes out
    through here, so this is also where it gets its keep-alive.

    Releasing only in the body generator's `finally` leaks the lease when the
    client disconnects before the first byte: Starlette then never starts the
    generator, so its `finally` never runs, and the session answers 409
    "busy" until the backend restarts. `__call__` always returns or raises.
    """

    def __init__(self, content: Any, *, lease: _Lease, **kwargs: Any):
        if hasattr(content, "__aiter__"):
            content = with_keepalive(content)
        super().__init__(content, **kwargs)
        self._lease = lease

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._lease.release()
