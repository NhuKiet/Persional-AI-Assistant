"""tools/db_backup.py — backing up and restoring the app's Postgres data.

The first half needs no database. The second half runs against the real
Supabase container when it is up (skipped otherwise): it only ever READS the
live database; everything it writes goes to scratch databases it creates and
drops, and to pytest's temporary directory.
"""
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location("db_backup", Path(__file__).resolve().parents[1] / "tools" / "db_backup.py")
db_backup = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(db_backup)


# ── without a database ──────────────────────────────────────────────────────

def test_tables_are_restored_parents_first():
    keys = [("messages", "sessions"), ("sessions", "profiles")]

    order = db_backup.parents_first(["messages", "news_items", "profiles", "sessions"], keys)

    assert order.index("profiles") < order.index("sessions") < order.index("messages")
    assert set(order) == {"messages", "news_items", "profiles", "sessions"}


def test_a_reference_to_a_table_outside_the_backup_does_not_block_the_order():
    assert db_backup.parents_first(["messages"], [("messages", "sessions")]) == ["messages"]


def test_tables_that_reference_each_other_in_a_cycle_are_refused():
    with pytest.raises(db_backup.BackupError, match="cycle"):
        db_backup.parents_first(["a", "b"], [("a", "b"), ("b", "a")])


def test_only_the_newest_regular_backups_are_kept(tmp_path):
    for stamp in ("20261001-010000Z", "20261002-010000Z", "20261003-010000Z"):
        (tmp_path / f"king-db-{stamp}.dump").write_bytes(b"x")
        (tmp_path / f"king-db-{stamp}.json").write_text("{}")
    safety = tmp_path / "king-db-pre-restore-20260901-010000Z.dump"
    safety.write_bytes(b"x")
    unrelated = tmp_path / "notes.txt"
    unrelated.write_text("mine")

    removed = db_backup.prune(tmp_path, keep=2)

    assert [path.name for path in removed] == ["king-db-20261001-010000Z.dump"]
    assert sorted(path.name for path in tmp_path.iterdir()) == [
        "king-db-20261002-010000Z.dump", "king-db-20261002-010000Z.json",
        "king-db-20261003-010000Z.dump", "king-db-20261003-010000Z.json",
        "king-db-pre-restore-20260901-010000Z.dump", "notes.txt",
    ]


def test_the_container_is_named_after_the_supabase_project(monkeypatch):
    monkeypatch.delenv("KING_DB_CONTAINER", raising=False)
    assert db_backup.default_container() == "supabase_db_supabase-session-store"

    monkeypatch.setenv("KING_DB_CONTAINER", "my-postgres")
    assert db_backup.default_container() == "my-postgres"


def test_a_stopped_database_is_reported_with_what_to_do():
    def stopped(argv, **_):
        return subprocess.CompletedProcess(argv, 1, stdout=b"", stderr=b"Error: No such object: db")

    with pytest.raises(db_backup.BackupError, match="supabase start"):
        db_backup.Postgres("db", run=stopped).check_running()


def test_a_missing_docker_is_reported_plainly():
    def no_docker(argv, **_):
        raise FileNotFoundError("docker")

    with pytest.raises(db_backup.BackupError, match="docker command was not found"):
        db_backup.Postgres("db", run=no_docker).check_running()


def test_restore_changes_nothing_without_yes(tmp_path, monkeypatch, capsys):
    def never(*_args, **_kwargs):
        raise AssertionError("restore without --yes must not reach the database")

    monkeypatch.setattr(db_backup.subprocess, "run", never)

    code = db_backup.main(["--dir", str(tmp_path), "--container", "db", "restore", str(tmp_path / "x.dump")])

    assert code == 2
    assert "Nothing was changed" in capsys.readouterr().out


def test_a_backup_that_changed_on_disk_is_not_trusted(tmp_path):
    class Running:
        def check_running(self):
            pass

    dump = tmp_path / "king-db-20261001-010000Z.dump"
    dump.write_bytes(b"what is on disk now")
    db_backup.manifest_path(dump).write_text(json.dumps({"sha256": "0" * 64, "tables": {}}))

    with pytest.raises(db_backup.BackupError, match="checksum"):
        db_backup.verify(Running(), dump)


def test_table_names_are_checked_before_they_reach_sql():
    assert db_backup._quoted("news_items") == '"public"."news_items"'
    with pytest.raises(db_backup.BackupError):
        db_backup._quoted('x"; drop table sessions; --')


# ── against the real database container ─────────────────────────────────────

@pytest.fixture
def postgres():
    server = db_backup.Postgres(db_backup.default_container())
    try:
        server.check_running()
    except db_backup.BackupError as reason:
        pytest.skip(str(reason))
    return server


@pytest.fixture
def scratch(postgres, tmp_path):
    """A throwaway database holding a restored copy of the live data, and the
    backup it came from."""
    manifest = db_backup.backup(postgres, tmp_path, keep=None)
    dump = tmp_path / manifest["file"]
    name = postgres.create_scratch()
    try:
        postgres.restore_everything(name, dump)
        yield name, dump, manifest
    finally:
        postgres.drop_database(name)


def test_a_backup_is_restore_tested_and_its_contents_recorded(postgres, tmp_path):
    manifest = db_backup.backup(postgres, tmp_path)

    dump = tmp_path / manifest["file"]
    assert dump.stat().st_size == manifest["bytes"] > 0
    assert json.loads(db_backup.manifest_path(dump).read_text())["sha256"] == db_backup.checksum(dump)
    assert set(manifest["tables"]) == {"messages", "news_items", "profiles", "sessions"}
    assert manifest["tables"]["profiles"] >= 1
    assert not list(tmp_path.glob("*.partial"))
    assert db_backup.verify(postgres, dump) == manifest["tables"]


def test_a_truncated_backup_fails_verification(postgres, tmp_path):
    manifest = db_backup.backup(postgres, tmp_path)
    dump = tmp_path / manifest["file"]
    dump.write_bytes(dump.read_bytes()[: manifest["bytes"] // 2])

    with pytest.raises(db_backup.BackupError, match="checksum"):
        db_backup.verify(postgres, dump)

    db_backup.manifest_path(dump).unlink()  # even with nothing recorded to compare against
    with pytest.raises(db_backup.BackupError):
        db_backup.verify(postgres, dump)


def test_restore_puts_back_exactly_what_the_backup_holds(postgres, scratch, tmp_path):
    database, dump, manifest = scratch
    postgres._query(
        database,
        "delete from messages where id % 2 = 0; delete from news_items where id % 3 = 0; "
        "insert into news_items (url, title, title_vi, summary_vi, source, topic) "
        "values ('http://junk.example', 'junk', 'junk', 'junk', 'junk', 'research')",
        "damaging the scratch copy",
    )
    damaged = postgres.row_counts(database)
    assert damaged != manifest["tables"]

    result = db_backup.restore(postgres, dump, tmp_path, database=database)

    assert postgres.row_counts(database) == manifest["tables"] == result["after"]
    assert postgres._query(database, "select count(*) from news_items where source = 'junk'", "q") == ["0"]
    # What was there before the restore is kept, restore-tested like any backup.
    safety = tmp_path / result["safety_backup"]
    assert safety.name.startswith("king-db-pre-restore-")
    assert json.loads(db_backup.manifest_path(safety).read_text())["tables"] == damaged
    # Identity sequences continue after the restored rows instead of colliding.
    highest = int(postgres._query(database, "select coalesce(max(id), 0) from news_items", "q")[0])
    new_id = int(postgres._query(
        database,
        "insert into news_items (url, title, title_vi, summary_vi, source, topic) "
        "values ('http://next.example', 'n', 'n', 'n', 'n', 'research') returning id", "q",
    )[0])
    assert new_id > highest


def test_a_restore_that_cannot_finish_leaves_the_data_untouched(postgres, scratch, tmp_path):
    database, dump, _manifest = scratch
    # A table the backup knows nothing about now depends on `sessions`.
    postgres._query(
        database,
        "create table later_feature (session_id uuid references sessions(id)); "
        "insert into later_feature select id from sessions limit 1; "
        "delete from news_items where id % 2 = 0",
        "changing the scratch copy",
    )
    before = postgres.row_counts(database)

    with pytest.raises(db_backup.BackupError):
        db_backup.restore(postgres, dump, tmp_path, database=database)

    assert postgres.row_counts(database) == before


def test_the_drill_leaves_no_scratch_database_behind(postgres, tmp_path):
    db_backup.backup(postgres, tmp_path)

    leftovers = postgres._query("postgres", f"select datname from pg_database where datname like '{db_backup.SCRATCH_PREFIX}%'", "q")

    assert leftovers == []
