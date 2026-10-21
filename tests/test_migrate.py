"""tools/migrate.py — applying supabase/migrations/ to a hosted Postgres.

The second half runs against the local Supabase Postgres when it is up
(skipped otherwise), and only ever writes to a scratch database it creates
and drops.
"""
import importlib.util
import secrets
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

_SPEC = importlib.util.spec_from_file_location("migrate", Path(__file__).resolve().parents[1] / "tools" / "migrate.py")
migrate = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(migrate)


# ── without a database ──────────────────────────────────────────────────────

def test_files_run_oldest_first_and_are_known_by_their_timestamp(tmp_path):
    for name in ("20260728120000_news_items.sql", "20260726080644_initial_schema.sql", "notes.txt"):
        (tmp_path / name).write_text("select 1;")

    files = migrate.migration_files(tmp_path)

    assert [(version, path.name) for version, path in files] == [
        ("20260726080644", "20260726080644_initial_schema.sql"),
        ("20260728120000", "20260728120000_news_items.sql"),
    ]


def test_only_files_not_yet_applied_are_pending(tmp_path):
    files = [("1", tmp_path / "1_a.sql"), ("2", tmp_path / "2_b.sql")]

    assert migrate.pending(files, {"1"}) == [files[1]]
    assert migrate.pending(files, {"1", "2"}) == []


def test_without_a_database_url_the_app_is_not_blocked(monkeypatch, capsys):
    monkeypatch.delenv("SUPABASE_DB_URL", raising=False)

    assert migrate.main([]) == 0
    assert "nothing to migrate" in capsys.readouterr().err


def test_the_repository_migrations_are_found():
    names = [path.name for _, path in migrate.migration_files()]
    assert names and names[0].endswith("_initial_schema.sql")


# ── against the local Supabase Postgres ─────────────────────────────────────

@pytest.fixture
def scratch_url():
    psycopg = pytest.importorskip("psycopg")
    from backend.app.core.config import settings

    if not settings.SUPABASE_DB_URL:
        pytest.skip("SUPABASE_DB_URL is not set")
    server = urlsplit(settings.SUPABASE_DB_URL)
    try:
        admin = psycopg.connect(settings.SUPABASE_DB_URL, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as reason:
        pytest.skip(f"database not reachable: {reason}")
    name = "king_migrate_check_" + secrets.token_hex(4)
    with admin:
        admin.execute(f'create database "{name}"')
        try:
            yield urlunsplit(server._replace(path="/" + name))
        finally:
            admin.execute(f'drop database if exists "{name}" with (force)')


def _tables(url):
    import psycopg

    with psycopg.connect(url) as conn:
        rows = conn.execute("select table_name from information_schema.tables where table_schema = 'public'")
        return {row[0] for row in rows}


def test_an_empty_database_gets_every_table_and_a_second_run_changes_nothing(scratch_url):
    first = migrate.migrate(scratch_url)
    second = migrate.migrate(scratch_url)

    assert len(first) == len(migrate.migration_files())
    assert second == []
    assert {"profiles", "sessions", "messages", "news_items", "king_schema_migrations"} <= _tables(scratch_url)


def test_a_database_the_supabase_cli_already_migrated_is_left_alone(scratch_url):
    import psycopg

    with psycopg.connect(scratch_url, autocommit=True) as conn:
        conn.execute("create schema supabase_migrations")
        conn.execute("create table supabase_migrations.schema_migrations (version text primary key)")
        for version, _ in migrate.migration_files():
            conn.execute("insert into supabase_migrations.schema_migrations values (%s)", (version,))

    assert migrate.migrate(scratch_url) == []
    assert "sessions" not in _tables(scratch_url)


def test_a_failing_file_leaves_no_trace_and_is_retried(scratch_url, tmp_path):
    import psycopg

    (tmp_path / "1_good.sql").write_text("create table good (id int);")
    (tmp_path / "2_bad.sql").write_text("create table half (id int); select * from no_such_table;")

    with pytest.raises(psycopg.errors.UndefinedTable):
        migrate.migrate(scratch_url, directory=tmp_path)

    tables = _tables(scratch_url)
    assert "good" in tables and "half" not in tables
    (tmp_path / "2_bad.sql").write_text("create table half (id int);")
    assert migrate.migrate(scratch_url, directory=tmp_path) == ["2_bad.sql"]
