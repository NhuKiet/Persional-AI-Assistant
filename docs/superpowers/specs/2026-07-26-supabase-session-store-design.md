# Supabase Session Store (Sub-project 1 of Storage Split)

**Date:** 2026-07-26

**Status:** Approved design; awaiting written-spec review

**Scope:** Replace the SQLite-backed session/message storage (`backend/app/shared/conversation_store.py`, `backend/app/features/coding/service.py`'s duplicate store) with a Supabase-hosted Postgres store, reached via a direct database connection. Deletes SQLite from the codebase entirely — production code and tests. Does not touch Weaviate, does not add authentication, does not migrate existing SQLite data, and does not implement any of the other tables from the original broader proposal (`research_runs`, `attachments`, `artifacts`, `user_settings`, `usage_events`) — those are separate sub-projects with their own specs.

## 1. Problem

Chat, research, PDF, and coding session history is stored in `data/sessions.db`, a single SQLite file, via two independent implementations that both point at the same physical file: `backend/app/shared/conversation_store.py`'s `_SessionStore` (used by the `chat`, `research`, and `pdf` namespaces through `ConversationManager`) and `backend/app/features/coding/service.py`'s `_CodingSessionStore` (a near-identical copy for the `coding` namespace). Each session is one row holding the entire message list as a JSON blob in a single `messages` column; every write reads the blob, mutates it in Python, and writes the whole thing back.

The user wants to move business/user data to Supabase (Postgres) while Weaviate continues to own search content, chunks, and embeddings — the two stores should never overlap in responsibility. Supabase also gives a normalized `messages` table (one row per message) instead of a JSON blob, and a path toward multi-user support later without a second migration.

## 2. Requirements

Confirmed with the user during design:

1. **No real authentication yet.** The app stays single-user. `profiles` gets exactly one seeded row with a fixed, hardcoded UUID. The schema is shaped to support multiple users later (see section 4), but no login flow, JWT, or Supabase Auth integration is built now.
2. **New Supabase project**, created during implementation — no existing project or connection string to reuse.
3. **No data migration.** Existing `data/sessions.db` is not read, converted, or imported. Supabase starts empty. This was confirmed twice during design, the second time explicitly: *"không dính dáng gì đến SQLite nữa"* — not just "don't migrate," but SQLite is removed from the codebase entirely, including test infrastructure (see section 8).
4. **No silent fallback.** If Supabase is unreachable or unconfigured, the request fails with a clear error. No local SQLite fallback, no degraded mode.
5. **Interface stability for the four existing routers.** `ConversationManager`'s public methods (`get_history`, `get_history_with_revision`, `add_turn`, `clear_session`) do not change signature or behavior. `chat` and `pdf` routers/services need zero changes. `coding`'s router/service changes only insofar as its duplicate store implementation is retired in favor of the shared one (section 6.4). `research`'s service gains error handling around two storage calls that today have none — see section 7 — but this changes only what happens on a storage failure, not the SSE contract's shape on success.
6. **Local Docker-based integration testing**, via the Supabase CLI's local stack (`supabase start`), not a hosted test project.

## 3. Why a Direct Postgres Connection, Not `supabase-py`

`save()` must perform, atomically: upsert the session row, lock it, delete its existing messages, insert the full new message list, increment `revision`, and update `updated_at`. `supabase-py`'s client talks to PostgREST over HTTP — each `.delete()`/`.insert()`/`.update()` is a separate HTTP request with no shared transaction. A failure between the delete and the insert would drop a session's entire history, and a `SELECT ... FOR UPDATE` lock has no PostgREST equivalent at all.

A direct connection (`psycopg`, the current psycopg v3) opens a real transaction, runs all of the above inside it, and commits or rolls back as one unit. Supabase is still the host; this only changes which client library reaches it. `supabase-py` is not used anywhere in this sub-project — if a later sub-project needs Supabase Storage (for `attachments`) or wants to lean on PostgREST/RLS with a real auth token, it can add `supabase-py` then, independently.

## 4. Schema

```sql
create table profiles (
    id uuid primary key,
    display_name text,
    created_at timestamptz not null default now()
);

create table sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references profiles(id),
    client_key text not null,
    updated_at timestamptz not null default now(),
    revision integer not null default 0,
    unique (user_id, client_key)
);

create table messages (
    id bigint generated always as identity primary key,
    session_id uuid not null
        references sessions(id)
        on delete cascade,
    role text not null
        check (role in ('user', 'assistant', 'system')),
    content jsonb not null,
    created_at timestamptz not null default now()
);

create index messages_session_id_idx on messages(session_id, id);

alter table profiles enable row level security;
alter table sessions enable row level security;
alter table messages enable row level security;
-- No policies granted to anon/authenticated.
```

**On RLS and the direct connection — precisely, not loosely.** RLS is a PostgreSQL engine feature, enforced on every connection regardless of whether it arrives through PostgREST or a direct driver connection like this sub-project's. What actually determines whether RLS applies to a given query is the *role* the connection authenticates as: it is bypassed only for the table owner, a superuser, or a role explicitly granted `BYPASSRLS` — never merely because the connection skipped PostgREST.

Phase 1 (this sub-project) connects using Supabase's `postgres` role — the project's owner-level role, which bypasses RLS on these tables by virtue of ownership, not because the connection is "direct." `SUPABASE_DB_URL` therefore contains owner-level credentials: backend-only, injected via environment/secret, never sent to the frontend, never logged. If a later sub-project switches to a more restricted database role for defense-in-depth, RLS with zero policies would then block every query from that role, not just PostgREST/anon access — that would need explicit policies at that point, not before.

The zero-policy RLS enabled above is a forward guard for the *other* access path: if a later sub-project ever exposes these tables to PostgREST with an `anon` or `authenticated` API key, nothing is readable by default until a policy is explicitly added there. It costs nothing today and protects a path this sub-project doesn't use yet.

### 4.1 `client_key` and the uniqueness fix

`client_key` is exactly the string `ConversationManager._key()` already produces today: `f"{namespace}:{session_id}"` (e.g. `"research:abc123"`). No new parsing or column split is needed — the store treats it as an opaque string, identical to how SQLite's `sessions.key TEXT PRIMARY KEY` treats it today.

The uniqueness constraint is `unique (user_id, client_key)`, not `unique (client_key)` alone. A single global-unique `client_key` would make it impossible for two different users to independently have a session named `chat:default` once multi-user support is added later — scoping uniqueness to `user_id` avoids a second migration for that. Every query still fixes `user_id` to the one seeded profile row, so no caller-visible behavior changes.

### 4.2 `content jsonb`, not `content text`

Research stores non-string content: `backend/app/features/research/service.py:102` calls `add_turn(..., role="assistant", content=event.get("data", {}))` — a `dict`, not a string. SQLite's JSON-blob-per-session design absorbed this by construction (the whole history list, including this dict, gets `json.dumps`'d together). A `text` column per message would force choosing between rejecting the dict outright or stringifying it and returning a string on read where callers currently get a dict back — a real behavior change. `jsonb` avoids the choice: a string stays a string, this dict stays a dict, both round-trip through `load()` as the same Python type they were before.

### 4.3 Fixed profile

One row, seeded during setup, with a hardcoded UUID constant (not a config value — it is not meant to be configurable) referenced from the store module, e.g. `_DEFAULT_PROFILE_ID = "00000000-0000-0000-0000-000000000001"`. Every query filters on this id. This is explicitly a placeholder, not a design for multi-user: Supabase's own guidance is that a `profiles` table should reference `auth.users(id)` once real auth exists ([Managing user data](https://supabase.com/docs/guides/auth/managing-user-data)) — that reshaping is out of scope here and left for whenever auth is actually added.

## 5. Method Semantics

`_SupabaseSessionStore` implements the same five methods as today's `_SessionStore`, so `ConversationManager` requires zero changes.

**`load(key) -> list[dict]`**
Delegates to `load_with_revision(key)[0]`.

**`load_with_revision(key) -> tuple[list[dict], int]`**
1. `select id, revision from sessions where user_id = %s and client_key = %s`.
2. No row → `([], 0)`.
3. Row found → `select role, content from messages where session_id = %s order by id`.
4. Return `([{"role": r["role"], "content": r["content"]} for r in rows], revision)`. `content` comes back as whatever Python type psycopg decodes the `jsonb` value to (dict for a dict, str for a string) — no extra parsing needed, but only because the pool is configured with `row_factory=dict_row` (section 6.3); psycopg's default row factory returns plain tuples, and indexing those by column name (`row["role"]`) would fail at runtime. This is not optional configuration — without it, this method is broken on first call.

**`save(key, messages: list[dict]) -> None`**
One transaction, four statements executed in order on the same connection. The session id fetched by statement 2 is reused as-is (as a Python variable, not re-queried) in statements 3-4:

```sql
-- 1. Ensure the session row exists (no-op if it already does).
insert into sessions (user_id, client_key)
values (%(user_id)s, %(client_key)s)
on conflict (user_id, client_key) do nothing;

-- 2. Fetch its id and take a row lock for the rest of this transaction.
--    The returned id is bound to `session_id` below.
select id from sessions
where user_id = %(user_id)s and client_key = %(client_key)s
for update;

-- 3. Replace its messages wholesale.
delete from messages where session_id = %(session_id)s;
insert into messages (session_id, role, content)
values (%(session_id)s, %(role)s, %(content)s), ...;   -- one row per message, in order, SKIPPED ENTIRELY if messages is empty

-- 4. Bump bookkeeping.
update sessions
set revision = revision + 1, updated_at = now()
where id = %(session_id)s;
```
This reproduces today's overwrite semantics exactly: `save()` still receives and stores the *entire* message list, same as SQLite's blob replacement — see section 8 for why this is deliberately not changed here.

Two implementation details that are easy to get wrong and must be treated as part of this contract, not left to whoever writes the code:

- **`content` values must be wrapped in `psycopg.types.json.Jsonb(...)` before being passed as a parameter**, for every message regardless of whether its `content` is a `str` or a `dict`. Psycopg 3 does not infer "this Python value should become a `jsonb` column" on its own — an unwrapped `dict` parameter against a `jsonb` column raises an adaptation error, and an unwrapped `str` would insert as a bare SQL string literal rather than a JSON-encoded string, breaking the round-trip `load_with_revision` promises in the previous method's description.
- **Statement 3's `insert` only runs `if messages:`.** `executemany` (or an equivalent multi-row insert) with an empty parameter sequence is either a no-op or a malformed statement depending on how it's built — `save(key, [])` must still run statements 1, 2, and 4 (the session row is created/kept and `revision` still increments), just skip the insert. See section 9.3's "empty history" test.

**`delete(key) -> None`**
`delete from sessions where user_id = %s and client_key = %s`. `messages` rows are removed by the `on delete cascade` foreign key.

**`cleanup_old(max_age_days=30) -> int`**
`delete from sessions where user_id = %s and updated_at < %s returning id`, count the returned rows. Cascade removes their messages.

## 6. Components

### 6.1 New dependency

`psycopg[binary,pool]` (psycopg 3) added to `pyproject.toml` — **both** extras are required. `binary` avoids requiring `libpq` build tooling on every environment that runs the backend. `pool` is not bundled into the base `psycopg` package at all; connection pooling lives in the separate `psycopg_pool` distribution, and `from psycopg_pool import ConnectionPool` fails at import time without this extra ([Psycopg installation](https://www.psycopg.org/psycopg3/docs/basic/install.html)).

### 6.2 New setting

`backend/app/core/config.py` gains `SUPABASE_DB_URL: str | None = None` — a Postgres connection string (`postgresql://...`), not the `SUPABASE_URL` + anon/service key pair `supabase-py` would use. This sub-project never talks to PostgREST, so no API key is needed.

### 6.3 `backend/app/shared/conversation_store.py`

- `_SessionStore` (the SQLite class) is deleted.
- `_SupabaseSessionStore` is added, implementing the five methods from section 5.
- **Lazy initialization is mandatory.** The constructor performs no I/O:
  ```python
  from psycopg.rows import dict_row
  from psycopg_pool import ConnectionPool

  class _SupabaseSessionStore:
      def __init__(self):
          self._pool: ConnectionPool | None = None

      def _get_pool(self) -> ConnectionPool:
          if self._pool is None:
              if not settings.SUPABASE_DB_URL:
                  raise RuntimeError("SUPABASE_DB_URL chưa cấu hình.")
              self._pool = ConnectionPool(
                  conninfo=settings.SUPABASE_DB_URL,
                  min_size=1,
                  max_size=5,
                  timeout=5,
                  open=False,
                  kwargs={"row_factory": dict_row, "connect_timeout": 5},
              )
              self._pool.open(wait=True)
          return self._pool

      def close(self) -> None:
          if self._pool is not None:
              self._pool.close()
              self._pool = None
  ```
  If the constructor validated config or opened a connection eagerly, `_store = _SupabaseSessionStore()` at module import time would run before any test gets a chance to monkeypatch `_store`, and the entire test suite would fail at collection — not just the tests that care about storage. Every method call goes through `_get_pool()`, so a missing or unreachable database surfaces as a `RuntimeError` on first actual use, not at import. `row_factory=dict_row` is what makes `row["role"]`/`row["content"]` in section 5 valid — psycopg's default row factory returns plain tuples.

  `max_size=5` and `timeout=5` (seconds) are starting values, not load-tested numbers; the implementation plan should treat them as easy to revisit, not as a constraint worth spending design time on now.

- **Pool lifecycle is tied to the FastAPI app, not left to open forever.** `main.py`'s lifespan shutdown handler calls `_store.close()` (or an equivalent app-level hook that reaches the singleton) so the pool's connections are released on a clean shutdown, rather than depending on process exit or the OS to reclaim them. This matters most for `--reload` development, where a leaked pool from a prior process generation is easy to lose track of.
- `ConversationManager` itself is unchanged — same public methods, same bodies, still calling `_store.load(...)`, `_store.save(...)`, etc.
- Module-level `_store = _SupabaseSessionStore()` replaces today's `_store = _SessionStore()`.

Session-mode pooling (as configured above) is correct for this backend because it is a long-lived process, not serverless; a transaction pooler would be the right choice only if the deployment model changes to something that opens/closes connections far more aggressively ([Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)).

### 6.4 `backend/app/features/coding/service.py`

Confirmed against the current file (`coding/service.py:104-127`): `CodingConversationManager` is a byte-for-byte structural duplicate of `ConversationManager` — the same four methods (`get_history`, `get_history_with_revision`, `add_turn`, `clear_session`), same bodies, only calling the module-level `_sessions` store instead of `_store` and defaulting to `namespace="coding"` instead of `"chat"`. It adds no coding-specific behavior.

Decided, not left open: `_CodingSessionStore`, the module-level `_sessions` singleton, and `CodingConversationManager` are all three **deleted**. `coding/router.py` and `coding/service.py` construct `ConversationManager(namespace="coding")` from the shared module instead — the same class the `chat`, `research`, and `pdf` namespaces already use. This is consistent with the decision to remove SQLite outright rather than keep a compatibility shim (section 8): there is no longer a reason to keep a separate coding-specific manager type around, compatibility-aliased or otherwise. After this change there is exactly one store implementation, one manager class, and one physical set of tables serving all four namespaces.

Coding's tests move to `FakeSessionStore` exactly like the other three namespaces (section 9.1) — patching the shared `conv_mod._store`, not a coding-specific fixture.

## 7. Storage Failures Must Surface as a Structured SSE Event, Not a Dropped Connection

Confirmed against the current code, two gaps that this sub-project's "no silent fallback, errors surface clearly" requirement (section 2, item 4) does not actually satisfy today, and must close:

- `research/router.py`'s `generate()` wraps the SSE loop in `try/finally`, not `try/except` (`router.py:50-56`) — an exception raised anywhere inside `service.stream_events(req)` propagates unhandled, which FastAPI turns into an abrupt stream termination, not a `{"type": "error", ...}` event a client can render.
- `research/service.py`'s `stream_events` calls `self._conv_manager.get_history(req.session_id)` at the top of the method, outside any `try` (`service.py:77`) — a storage failure there raises immediately, hitting the gap above. Separately, on success the `"done"` event is yielded *before* `add_turn` persists the turn (`service.py:96-102`): if persistence fails after that yield, the client has already received and rendered a complete answer while the turn silently never made it into history.

Fixing this touches `research/service.py` (not `chat` or `pdf`, whose call sites don't have this ordering problem — confirm during planning rather than assume, but the two gaps above are specific to how `research/service.py` is structured). Two changes, both internal, neither changing the SSE contract's shape on the success path:

1. Wrap the history-load call and the two `add_turn` calls in `try/except`, converting a storage failure into:
   ```json
   {"type": "error", "code": "storage_unavailable", "message": "Không thể kết nối kho lịch sử."}
   ```
   Never forward the raw exception message to the client — a connection failure's exception text can contain the database hostname or other infrastructure detail that has no reason to reach a browser.
2. Keep the "done" event as the terminal success signal — that part is correct and unchanged — but if the persistence calls after it fail, emit the `storage_unavailable` error as a follow-up event rather than letting the exception propagate unhandled. The client already treats `"done"` as complete; the follow-up error is the mechanism for it to additionally learn "but this didn't get saved," which today it cannot learn at all.

## 8. Explicitly Out of Scope

- **SQLite data migration.** Nothing reads `data/sessions.db`. The file is left on disk, untouched, orphaned — not deleted by this work, but also not referenced by any code path afterward.
- **`MAX_HISTORY` destructive truncation.** `ConversationManager.add_turn` still loads the full history, appends, truncates to `settings.MAX_HISTORY` (20), and calls `save()` with the truncated list — `save()` still overwrites, so anything beyond the last 20 messages is still permanently discarded, exactly as today. Postgres's per-row `messages` table makes "store everything, window at read time" a natural follow-up, but changing that now would be a behavior change bundled into what is supposed to be a pure storage-backend swap. Left as a clearly-visible follow-up, not built here.
- **Authentication.** No login, no JWT, no Supabase Auth. Section 4.3's fixed profile is a placeholder.
- **`research_runs`, `attachments`, `artifacts`, `user_settings`, `usage_events`.** Each is its own sub-project per the original decomposition; none of their tables are created here.

## 9. Testing

### 9.1 Existing tests move to a pure in-memory fake

New file `tests/fake_session_store.py`:

```python
from copy import deepcopy

class FakeSessionStore:
    """In-memory test double — no SQLite, no Supabase, no I/O. Implements the
    same five-method contract as the production store."""

    def __init__(self):
        self._data: dict[str, tuple[list[dict], int]] = {}

    def load(self, key: str) -> list[dict]:
        return self.load_with_revision(key)[0]

    def load_with_revision(self, key: str) -> tuple[list[dict], int]:
        messages, revision = self._data.get(key, ([], 0))
        return deepcopy(messages), revision

    def save(self, key: str, messages: list[dict]) -> None:
        _, revision = self._data.get(key, ([], 0))
        self._data[key] = (deepcopy(messages), revision + 1)

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def cleanup_old(self, max_age_days: int = 30) -> int:
        # No test exercises real time-based cleanup against this fake today;
        # provided for interface completeness. Add real aging behavior here
        # if a test needs it.
        return 0
```

`deepcopy`, not `list(messages)`. A shallow copy shares the same inner dict objects between what the fake stores and what a caller holds — `loaded = store.load(key); loaded[0]["content"] = "x"` would silently mutate the fake's stored state without ever calling `save()`, a mutation neither SQLite nor real Postgres exhibits (both round-trip through serialization, which inherently copies). A test that happened to rely on that aliasing would pass against the fake and fail against the real store, which defeats the fake's purpose.

Every one of the ~20 existing test files across `chat`/`research`/`pdf`/`coding` that today does
`monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))` (or the coding equivalent, `coding_service._CodingSessionStore(tmp_path / "s.db")`) changes to
`monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())` — a one-line, mechanical, per-file swap. No assertion logic changes; these tests were never testing SQLite itself, only that *some* working store exists. `tmp_path` is no longer needed by these fixtures.

### 9.2 Unit tests for `_SupabaseSessionStore` itself

Cover what doesn't need a real database: the lazy-init contract (constructing the store does not raise or connect; calling a method with `SUPABASE_DB_URL` unset raises `RuntimeError`), and any error-mapping the implementation adds around connection failures.

### 9.3 Integration tests against real Postgres

Marked `@pytest.mark.supabase_integration`, run against the Supabase CLI's local stack (`supabase start`, Docker-based — confirmed available for this environment). These are the only tests that can actually prove: the `save()` transaction is atomic, the delete-then-insert sequencing is correct, `on delete cascade` really removes messages when a session is deleted, `jsonb` round-trips a dict and a string both correctly, `messages` ordering by `id` is stable, `revision` increments correctly under the row lock, the `unique(user_id, client_key)` constraint rejects a duplicate, and `cleanup_old` deletes the right rows and only those. None of this is provable by mocking `psycopg` — a mock proves the store *called* the right methods, not that Postgres *does* the right thing with them, which is the actual point of sections 4 and 5. Supabase's local development workflow and database-testing guidance cover the setup mechanics ([Local development](https://supabase.com/docs/guides/local-development/cli-workflows), [Database testing](https://supabase.com/docs/guides/database/testing)).

Two cases beyond the list above are required, not optional additions:

- **Real rollback.** Save a valid history. Then call `save()` again with a message whose `role` violates the `check (role in (...))` constraint, so the `insert` fails *after* the `delete` has already run inside the same transaction. Assert that `load_with_revision` afterward still returns the original messages and the original `revision`, unchanged. This is the single test that actually justifies section 3's choice of a direct transactional connection over `supabase-py` — without it, the atomicity claim is asserted but never verified.
- **Empty history.** `save(key, [])` then `load_with_revision(key) == ([], 1)` — the session row exists (created by the upsert, `revision` incremented once) with zero messages, matching what today's SQLite implementation does with an empty list, and confirming the `if messages:` guard from section 5 doesn't skip the parts of the transaction that should still run.

Applied migrations for the schema in section 4 live under `supabase/migrations/`, per the CLI's standard layout, so the same SQL that creates the local test database also becomes the record of what to run against the real hosted project.

### 9.4 Concurrency: explicitly single-process for now

`ConversationManager.add_turn` still does load → append in Python → `save()` (unchanged, per section 8's decision not to touch this method). The transaction in section 5 makes `save()` atomic — it cannot leave the database half-deleted, half-inserted — but it does not prevent a **lost update**: if two processes both load revision 5, append different messages, and call `save()` in sequence, the second `save()` overwrites the first's contribution with a message list built from a snapshot that never saw it. The row lock inside `save()` serializes the two transactions against each other, but it starts only once `save()` begins, after both processes already have their (stale) in-memory message list.

This is unchanged from today's SQLite behavior and is explicitly not fixed in this sub-project — doing so would mean changing `add_turn`'s load-append-save shape, which is exactly the kind of behavior change section 8 rules out. What's different going forward is the deployment assumption: today's single SQLite file was never going to be hit by two backend processes anyway; a future move to multiple backend replicas would make this a real, reachable bug. In the app's current single-process deployment, `KeyedLockRegistry` (already used by `research/service.py` to reject a second concurrent stream for the same session) is sufficient, and this sub-project relies on that continuing to hold. A later version that needs multi-replica safety would need either an optimistic check (`update ... where revision = %(expected)s`, retrying on a zero-row update) or reshaping `save()` into an append-only transaction instead of load-all/replace-all — both are real design changes, not configuration, and belong to whichever sub-project actually needs multi-replica deployment.
