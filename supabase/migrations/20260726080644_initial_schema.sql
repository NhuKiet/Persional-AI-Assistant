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
-- No policies granted to anon/authenticated. This backend never connects
-- through PostgREST/anon — it authenticates directly as the Postgres
-- `postgres` role, which bypasses RLS by table ownership. RLS is enabled
-- here purely as a forward guard for a future PostgREST access path this
-- plan does not use.

insert into profiles (id, display_name)
values ('00000000-0000-0000-0000-000000000001', 'Default User');
