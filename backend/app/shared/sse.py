import json
from typing import Any, Protocol

from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send


def sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


class _Lease(Protocol):
    def release(self) -> None: ...


class LeasedStreamingResponse(StreamingResponse):
    """A stream that holds a session lease (shared/session_locks.py) and
    releases it however the response ends.

    Releasing only in the body generator's `finally` leaks the lease when the
    client disconnects before the first byte: Starlette then never starts the
    generator, so its `finally` never runs, and the session answers 409
    "busy" until the backend restarts. `__call__` always returns or raises.
    """

    def __init__(self, content: Any, *, lease: _Lease, **kwargs: Any):
        super().__init__(content, **kwargs)
        self._lease = lease

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._lease.release()
