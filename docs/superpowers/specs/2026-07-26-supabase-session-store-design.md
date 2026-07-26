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
3. **No data migration.** Existing `data/sessions.db` is not read, converted, or imported. Supabase starts empty. This was confirmed twice during design, the second time explicitly: *"không dính dáng gì đến SQLite nữa"* — not just "don't migrate," but SQLite is removed from the codebase entirely, including test infrastructure (see section 7).
4. **No silent fallback.** If Supabase is unreachable or unconfigured, the request fails with a clear error. No local SQLite fallback, no degraded mode.
5. **Interface stability for the four existing routers.** `ConversationManager`'s public methods (`get_history`, `get_history_with_revision`, `add_turn`, `clear_session`) do not change signature or behavior. The `chat`, `research`, and `pdf` routers/services need zero changes. `coding`'s router/service changes only insofar as its duplicate store implementation is retired in favor of the shared one (section 6.4).
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
-- No policies granted to anon/authenticated. The backend connects with a
-- direct Postgres connection under its own role, which does not go through
-- PostgREST or RLS at all. RLS is enabled with zero policies purely as a
-- forward guard: if a future sub-project ever exposes these tables to
-- PostgREST with an anon or authenticated key, nothing is readable by
-- default until a policy is explicitly added. It costs nothing today.
```

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
4. Return `([{"role": r["role"], "content": r["content"]} for r in rows], revision)`. `content` comes back as whatever Python type psycopg decodes the `jsonb` value to (dict for a dict, str for a string) — no extra parsing needed.

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
values (%(session_id)s, %(role)s, %(content)s), ...;   -- one row per message, in order

-- 4. Bump bookkeeping.
update sessions
set revision = revision + 1, updated_at = now()
where id = %(session_id)s;
```
This reproduces today's overwrite semantics exactly: `save()` still receives and stores the *entire* message list, same as SQLite's blob replacement — see section 7 for why this is deliberately not changed here.

**`delete(key) -> None`**
`delete from sessions where user_id = %s and client_key = %s`. `messages` rows are removed by the `on delete cascade` foreign key.

**`cleanup_old(max_age_days=30) -> int`**
`delete from sessions where user_id = %s and updated_at < %s returning id`, count the returned rows. Cascade removes their messages.

## 6. Components

### 6.1 New dependency

`psycopg[binary]` (psycopg 3) added to `pyproject.toml`. Using the binary distribution avoids requiring `libpq` build tooling on every environment that runs the backend.

### 6.2 New setting

`backend/app/core/config.py` gains `SUPABASE_DB_URL: str | None = None` — a Postgres connection string (`postgresql://...`), not the `SUPABASE_URL` + anon/service key pair `supabase-py` would use. This sub-project never talks to PostgREST, so no API key is needed.

### 6.3 `backend/app/shared/conversation_store.py`

- `_SessionStore` (the SQLite class) is deleted.
- `_SupabaseSessionStore` is added, implementing the five methods from section 5.
- **Lazy initialization is mandatory.** The constructor performs no I/O:
  ```python
  class _SupabaseSessionStore:
      def __init__(self):
          self._pool = None

      def _get_pool(self):
          if self._pool is None:
              if not settings.SUPABASE_DB_URL:
                  raise RuntimeError("SUPABASE_DB_URL chưa cấu hình.")
              self._pool = ConnectionPool(settings.SUPABASE_DB_URL, ...)
          return self._pool
  ```
  If the constructor validated config or opened a connection eagerly, `_store = _SupabaseSessionStore()` at module import time would run before any test gets a chance to monkeypatch `_store`, and the entire test suite would fail at collection — not just the tests that care about storage. Every method call goes through `_get_pool()`, so a missing or unreachable database surfaces as a `RuntimeError` on first actual use, not at import.
- `ConversationManager` itself is unchanged — same public methods, same bodies, still calling `_store.load(...)`, `_store.save(...)`, etc.
- Module-level `_store = _SupabaseSessionStore()` replaces today's `_store = _SessionStore()`.

Whether to use `psycopg_pool.ConnectionPool` (session mode, suited to a long-lived process — this backend is not serverless) versus a transaction pooler is a deployment detail, not a design fork; the code above assumes a long-lived pool, consistent with how this backend actually runs today ([Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)).

### 6.4 `backend/app/features/coding/service.py`

`_CodingSessionStore` — a duplicate of the old `_SessionStore`, pointed at the same physical SQLite file — is deleted, not reimplemented. `CodingConversationManager`'s four methods (`get_history`, `get_history_with_revision`, `add_turn`, `clear_session`, per the current file at lines 116/119/124/127) match `ConversationManager`'s shared surface exactly. The implementation plan must verify this directly against the current file before deciding between two equivalent outcomes:

- If `CodingConversationManager` truly adds nothing beyond what `ConversationManager(namespace="coding")` already provides, delete the class and have `coding/router.py`/`coding/service.py` construct a shared `ConversationManager` instead.
- If it turns out to carry coding-specific behavior beyond the four shared methods, keep the class but have it delegate to the shared `_SupabaseSessionStore` singleton instead of owning a second store.

Either way, there is exactly one store implementation and one physical set of tables after this change — never two.

## 7. Explicitly Out of Scope

- **SQLite data migration.** Nothing reads `data/sessions.db`. The file is left on disk, untouched, orphaned — not deleted by this work, but also not referenced by any code path afterward.
- **`MAX_HISTORY` destructive truncation.** `ConversationManager.add_turn` still loads the full history, appends, truncates to `settings.MAX_HISTORY` (20), and calls `save()` with the truncated list — `save()` still overwrites, so anything beyond the last 20 messages is still permanently discarded, exactly as today. Postgres's per-row `messages` table makes "store everything, window at read time" a natural follow-up, but changing that now would be a behavior change bundled into what is supposed to be a pure storage-backend swap. Left as a clearly-visible follow-up, not built here.
- **Authentication.** No login, no JWT, no Supabase Auth. Section 4.3's fixed profile is a placeholder.
- **`research_runs`, `attachments`, `artifacts`, `user_settings`, `usage_events`.** Each is its own sub-project per the original decomposition; none of their tables are created here.

## 8. Testing

### 8.1 Existing tests move to a pure in-memory fake

New file `tests/fake_session_store.py`:

```python
class FakeSessionStore:
    """In-memory test double — no SQLite, no Supabase, no I/O. Implements the
    same five-method contract as the production store."""

    def __init__(self):
        self._data: dict[str, tuple[list[dict], int]] = {}

    def load(self, key: str) -> list[dict]:
        return self.load_with_revision(key)[0]

    def load_with_revision(self, key: str) -> tuple[list[dict], int]:
        messages, revision = self._data.get(key, ([], 0))
        return list(messages), revision

    def save(self, key: str, messages: list[dict]) -> None:
        _, revision = self._data.get(key, ([], 0))
        self._data[key] = (list(messages), revision + 1)

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def cleanup_old(self, max_age_days: int = 30) -> int:
        # No test exercises real time-based cleanup against this fake today;
        # provided for interface completeness. Add real aging behavior here
        # if a test needs it.
        return 0
```

Every one of the ~20 existing test files across `chat`/`research`/`pdf`/`coding` that today does
`monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))` (or the coding equivalent, `coding_service._CodingSessionStore(tmp_path / "s.db")`) changes to
`monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())` — a one-line, mechanical, per-file swap. No assertion logic changes; these tests were never testing SQLite itself, only that *some* working store exists. `tmp_path` is no longer needed by these fixtures.

### 8.2 Unit tests for `_SupabaseSessionStore` itself

Cover what doesn't need a real database: the lazy-init contract (constructing the store does not raise or connect; calling a method with `SUPABASE_DB_URL` unset raises `RuntimeError`), and any error-mapping the implementation adds around connection failures.

### 8.3 Integration tests against real Postgres

Marked `@pytest.mark.supabase_integration`, run against the Supabase CLI's local stack (`supabase start`, Docker-based — confirmed available for this environment). These are the only tests that can actually prove: the `save()` transaction is atomic, the delete-then-insert sequencing is correct, `on delete cascade` really removes messages when a session is deleted, `jsonb` round-trips a dict and a string both correctly, `messages` ordering by `id` is stable, `revision` increments correctly under the row lock, the `unique(user_id, client_key)` constraint rejects a duplicate, and `cleanup_old` deletes the right rows and only those. None of this is provable by mocking `psycopg` — a mock proves the store *called* the right methods, not that Postgres *does* the right thing with them, which is the actual point of sections 4 and 5. Supabase's local development workflow and database-testing guidance cover the setup mechanics ([Local development](https://supabase.com/docs/guides/local-development/cli-workflows), [Database testing](https://supabase.com/docs/guides/database/testing)).

Applied migrations for the schema in section 4 live under `supabase/migrations/`, per the CLI's standard layout, so the same SQL that creates the local test database also becomes the record of what to run against the real hosted project.
