-- supabase/migrations/20260728120000_news_items.sql
create table news_items (
    id bigint generated always as identity primary key,
    url text not null unique,
    title text not null,
    title_vi text not null,
    summary_vi text not null,
    source text not null,
    topic text not null check (topic in ('model_release', 'research', 'robotics', 'community')),
    published_at timestamptz,
    fetched_at timestamptz not null default now()
);

create index news_items_topic_published_idx on news_items(topic, published_at desc, id desc);

alter table news_items enable row level security;
-- No policies granted, matching sessions/messages in the initial migration
-- — this backend connects directly as the `postgres` role and bypasses RLS
-- by table ownership. RLS is enabled purely as a forward guard for a future
-- PostgREST access path this app does not currently use.
