"""Back up and restore the app's Postgres data: chat history and news items.

The database is the local Supabase stack (`supabase start`), which runs
Postgres in a Docker container. This runs pg_dump and pg_restore INSIDE that
container, so they always match the server's version and nothing has to be
installed on the host. Standard library only: any Python 3.11+ can run it.

  backup    Dump schema `public` to data/backups/king-db-<UTC time>.dump,
            restore it into a scratch database to prove it can be read back,
            record what it holds, then keep only the newest --keep backups.
  verify    Check a backup again: its checksum, and a fresh restore drill.
  restore   Replace the live data with a backup. Needs --yes. Takes a safety
            backup first; the swap itself is one transaction, so a restore
            that fails leaves the database exactly as it was.
  list      Show the backups there are.

Usage:
  .venv/Scripts/python.exe tools/db_backup.py backup
  .venv/Scripts/python.exe tools/db_backup.py restore data/backups/king-db-....dump --yes

A backup on the same disk as the database does not survive that disk. Point
--dir (or KING_BACKUP_DIR) at another drive or a cloud-synced folder.

A restore loads data into the tables that are already there; the tables
themselves come from supabase/migrations. On a new machine: `supabase start`
first, then `restore`.
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DEFAULT_DIR = REPO / "data" / "backups"
DATABASE = "postgres"
SCHEMA = "public"
DEFAULT_KEEP = 14
SCRATCH_PREFIX = "king_restore_check_"

_STAMP = "%Y%m%d-%H%M%SZ"
# What `backup` writes and `prune` may delete. Safety backups taken before a
# restore are named king-db-pre-restore-… and are never pruned.
_REGULAR = re.compile(r"^king-db-\d{8}-\d{6}Z\.dump$")
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ROW_COUNTS = (
    "select table_name || '=' || (xpath('/row/c/text()', query_to_xml("
    "format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text "
    f"from information_schema.tables where table_schema = '{SCHEMA}' and table_type = 'BASE TABLE' order by 1"
)
_FOREIGN_KEYS = (
    "select c.relname || '>' || p.relname from pg_constraint k "
    "join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid "
    "join pg_namespace n on n.oid = k.connamespace "
    f"where k.contype = 'f' and n.nspname = '{SCHEMA}' and c.oid <> p.oid"
)


class BackupError(RuntimeError):
    """Something the person running the tool can act on; printed without a traceback."""


def default_container() -> str:
    """The Supabase CLI names its database container after the project id."""
    if name := os.environ.get("KING_DB_CONTAINER"):
        return name
    config = REPO / "supabase" / "config.toml"
    match = re.search(r'^project_id\s*=\s*"([^"]+)"', config.read_text(encoding="utf-8"), re.MULTILINE) if config.exists() else None
    if not match:
        raise BackupError("Cannot tell which container holds the database: set KING_DB_CONTAINER.")
    return f"supabase_db_{match.group(1)}"


def _quoted(table: str) -> str:
    if not _IDENTIFIER.match(table):
        raise BackupError(f"Refusing to touch a table with an unexpected name: {table!r}")
    return f'"{SCHEMA}"."{table}"'


class Postgres:
    """The database server, reached through `docker exec` on its container."""

    def __init__(self, container: str, run=subprocess.run):
        self.container = container
        self._run = run

    def _docker(self, *argv: str, stdin=None, stdout=subprocess.PIPE, what: str) -> subprocess.CompletedProcess:
        try:
            done = self._run(["docker", *argv], stdin=stdin, stdout=stdout, stderr=subprocess.PIPE)
        except FileNotFoundError:
            raise BackupError("The docker command was not found. Is Docker installed and on PATH?") from None
        if done.returncode != 0:
            reason = (done.stderr or b"").decode("utf-8", "replace").strip().splitlines()
            raise BackupError(f"{what} failed: {reason[-1] if reason else f'exit code {done.returncode}'}")
        return done

    def _exec(self, *argv: str, stdin=None, stdout=subprocess.PIPE, what: str) -> subprocess.CompletedProcess:
        flags = ["-i"] if stdin is not None else []
        return self._docker("exec", *flags, self.container, *argv, stdin=stdin, stdout=stdout, what=what)

    def _query(self, database: str, sql: str, what: str) -> list[str]:
        done = self._exec("psql", "-U", "postgres", "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql, what=what)
        return [line for line in done.stdout.decode("utf-8").splitlines() if line]

    def check_running(self) -> None:
        try:
            done = self._run(
                ["docker", "inspect", "-f", "{{.State.Running}}", self.container],
                stdin=None, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
        except FileNotFoundError:
            raise BackupError("The docker command was not found. Is Docker installed and on PATH?") from None
        if done.returncode != 0 or done.stdout.decode().strip() != "true":
            raise BackupError(
                f"The database container '{self.container}' is not running. "
                "Start Docker Desktop and run `supabase start`, then try again."
            )

    def dump(self, database: str, destination: Path) -> None:
        with destination.open("wb") as out:
            self._exec(
                "pg_dump", "-U", "postgres", "-d", database, f"--schema={SCHEMA}", "--format=custom",
                stdout=out, what="pg_dump",
            )
        if destination.stat().st_size == 0:
            raise BackupError("pg_dump wrote an empty file.")

    def data_entries(self, dump: Path) -> tuple[dict[str, str], list[str]]:
        """From the dump's table of contents: the entry of each table's data,
        by table, and the entries that set the sequences."""
        with dump.open("rb") as source:
            listing = self._exec("pg_restore", "--list", stdin=source, what="Reading the backup").stdout.decode("utf-8")
        tables, sequences = {}, []
        for line in listing.splitlines():
            if line.startswith(";"):
                continue
            if match := re.search(rf"\bTABLE DATA {SCHEMA} (\S+) ", line):
                tables[match.group(1)] = line
            elif f" SEQUENCE SET {SCHEMA} " in line:
                sequences.append(line)
        return tables, sequences

    def create_scratch(self) -> str:
        name = SCRATCH_PREFIX + secrets.token_hex(4)
        self._exec("createdb", "-U", "postgres", "-T", "template0", name, what="Creating the scratch database")
        return name

    def drop_database(self, name: str) -> None:
        if not name.startswith(SCRATCH_PREFIX):
            raise BackupError(f"Refusing to drop a database this tool did not create: {name}")
        self._exec("dropdb", "-U", "postgres", "--if-exists", name, what="Dropping the scratch database")

    def restore_everything(self, database: str, dump: Path) -> None:
        """Schema and data into an empty database; any error aborts the lot."""
        # template0 comes with an empty `public`; the dump brings its own.
        self._query(database, f"DROP SCHEMA {SCHEMA}", "Preparing the scratch database")
        with dump.open("rb") as source:
            self._exec(
                "pg_restore", "-U", "postgres", "-d", database, "--no-owner", "--no-privileges",
                "--exit-on-error", "--single-transaction",
                stdin=source, what="Restoring into the scratch database",
            )

    def row_counts(self, database: str) -> dict[str, int]:
        pairs = (line.rsplit("=", 1) for line in self._query(database, _ROW_COUNTS, "Counting rows"))
        return {table: int(count) for table, count in pairs}

    def foreign_keys(self, database: str) -> list[tuple[str, str]]:
        """(child, parent) for every foreign key between two tables of the schema."""
        return [tuple(line.split(">", 1)) for line in self._query(database, _FOREIGN_KEYS, "Reading foreign keys")]

    def replace_data(self, database: str, dump: Path) -> None:
        """Swap the data of every table the dump covers, in one transaction.

        pg_restore lists tables alphabetically, which loads `messages` before
        the `sessions` it points at; without superuser rights the foreign keys
        cannot be switched off, so the tables go in parents first instead.
        """
        entries, sequences = self.data_entries(dump)
        present = self.row_counts(database)
        if missing := sorted(set(entries) - set(present)):
            raise BackupError(
                f"The database has no table {', '.join(missing)} that this backup holds data for. "
                "Create the tables first (`supabase start` applies supabase/migrations), then restore."
            )
        order = parents_first(list(entries), self.foreign_keys(database))
        token = secrets.token_hex(4)
        inside_dump, inside_list = f"/tmp/king-restore-{token}.dump", f"/tmp/king-restore-{token}.list"
        try:
            with dump.open("rb") as source:
                self._exec("sh", "-c", 'cat > "$0"', inside_dump, stdin=source, what="Copying the backup into the container")
            with tempfile.TemporaryFile() as listing:
                listing.write(("\n".join([entries[t] for t in order] + sequences) + "\n").encode("utf-8"))
                listing.seek(0)
                self._exec("sh", "-c", 'cat > "$0"', inside_list, stdin=listing, what="Copying the restore order")
            with tempfile.TemporaryFile() as script:
                # No CASCADE: a table the backup doesn't cover but that points at
                # these would be emptied and never refilled. Without it such a
                # table makes the TRUNCATE — and so the whole restore — fail.
                truncate = ", ".join(_quoted(table) for table in order)
                script.write(f"TRUNCATE {truncate} RESTART IDENTITY;\n".encode("utf-8"))
                script.flush()
                # Written out in full before psql sees any of it: a pg_restore
                # that died halfway must not leave psql committing half the data.
                self._exec(
                    "pg_restore", "--data-only", "-L", inside_list, "-f", "-", inside_dump,
                    stdout=script, what="Reading the data out of the backup",
                )
                script.seek(0)
                self._exec(
                    "psql", "-U", "postgres", "-d", database, "--single-transaction",
                    "-v", "ON_ERROR_STOP=1", "-q", "-o", "/dev/null",
                    stdin=script, what="Loading the data",
                )
        finally:
            self._exec("rm", "-f", inside_dump, inside_list, what="Cleaning up inside the container")


def parents_first(tables: list[str], foreign_keys: list[tuple[str, str]]) -> list[str]:
    """`tables` ordered so that each comes after the tables it references."""
    waiting = {table: {parent for child, parent in foreign_keys if child == table and parent in tables} for table in tables}
    ordered: list[str] = []
    while waiting:
        ready = sorted(table for table, parents in waiting.items() if parents <= set(ordered))
        if not ready:
            raise BackupError(
                f"Tables {', '.join(sorted(waiting))} reference each other in a cycle; "
                "this tool cannot order them for a restore."
            )
        ordered.extend(ready)
        for table in ready:
            del waiting[table]
    return ordered


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def manifest_path(dump: Path) -> Path:
    return dump.with_suffix(".json")


def restore_drill(postgres: Postgres, dump: Path) -> dict[str, int]:
    """Restore `dump` into a throwaway database and count what arrived."""
    scratch = postgres.create_scratch()
    try:
        postgres.restore_everything(scratch, dump)
        return postgres.row_counts(scratch)
    finally:
        postgres.drop_database(scratch)


def backup(
    postgres: Postgres, directory: Path, keep: int | None = DEFAULT_KEEP,
    label: str = "", database: str = DATABASE, now=None,
) -> dict:
    """Write one verified backup of `database` into `directory`; returns its
    manifest. `keep=None` leaves older backups alone."""
    postgres.check_running()
    directory.mkdir(parents=True, exist_ok=True)
    taken = (now or datetime.datetime.now(datetime.timezone.utc)).strftime(_STAMP)
    final = directory / f"king-db-{label + '-' if label else ''}{taken}.dump"
    partial = final.with_suffix(".partial")
    try:
        postgres.dump(database, partial)
        tables = restore_drill(postgres, partial)
        manifest = {
            "file": final.name,
            "taken_at": taken,
            "bytes": partial.stat().st_size,
            "sha256": checksum(partial),
            "container": postgres.container,
            "tables": tables,
        }
        manifest_path(final).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        partial.replace(final)
    finally:
        partial.unlink(missing_ok=True)
    manifest["removed"] = [path.name for path in prune(directory, keep)] if keep is not None else []
    return manifest


def prune(directory: Path, keep: int) -> list[Path]:
    """Delete all but the `keep` newest regular backups, with their manifests."""
    if keep < 1:
        raise BackupError("--keep must be at least 1.")
    regular = sorted((path for path in directory.iterdir() if _REGULAR.match(path.name)), reverse=True)
    removed = regular[keep:]
    for dump in removed:
        dump.unlink()
        manifest_path(dump).unlink(missing_ok=True)
    return removed


def verify(postgres: Postgres, dump: Path) -> dict[str, int]:
    """Prove `dump` still restores, and still holds what was recorded for it."""
    postgres.check_running()
    if not dump.is_file():
        raise BackupError(f"No such backup: {dump}")
    recorded = json.loads(manifest_path(dump).read_text(encoding="utf-8")) if manifest_path(dump).exists() else None
    if recorded and checksum(dump) != recorded["sha256"]:
        raise BackupError(f"{dump.name} has changed since it was taken (checksum mismatch): do not trust it.")
    tables = restore_drill(postgres, dump)
    if recorded and tables != recorded["tables"]:
        raise BackupError(f"{dump.name} restores to {tables}, but {recorded['tables']} was recorded for it.")
    return tables


def restore(postgres: Postgres, dump: Path, directory: Path, database: str = DATABASE) -> dict:
    """Replace the data in `database` with `dump`. Returns what happened."""
    expected = verify(postgres, dump)
    safety = backup(postgres, directory, keep=None, label="pre-restore", database=database)
    before = postgres.row_counts(database)
    postgres.replace_data(database, dump)
    after = postgres.row_counts(database)
    restored = {table: after.get(table) for table in expected}
    if restored != expected:
        raise BackupError(f"The restore finished but the tables hold {restored}, not {expected}.")
    return {"before": before, "after": after, "safety_backup": safety["file"]}


def list_backups(directory: Path) -> list[dict]:
    backups = []
    for dump in sorted(directory.glob("king-db-*.dump"), reverse=True) if directory.is_dir() else []:
        recorded = json.loads(manifest_path(dump).read_text(encoding="utf-8")) if manifest_path(dump).exists() else {}
        backups.append({"file": dump.name, "bytes": dump.stat().st_size, "tables": recorded.get("tables")})
    return backups


def _rows(tables: dict[str, int] | None) -> str:
    return ", ".join(f"{table} {count}" for table, count in sorted(tables.items())) if tables else "contents not recorded"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dir", type=Path, default=Path(os.environ.get("KING_BACKUP_DIR") or DEFAULT_DIR), help="where backups live (default: data/backups, or KING_BACKUP_DIR)")
    parser.add_argument("--container", help="database container (default: from supabase/config.toml, or KING_DB_CONTAINER)")
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("backup", help="take a backup and prove it restores")
    make.add_argument("--keep", type=int, default=DEFAULT_KEEP, help=f"regular backups to keep (default {DEFAULT_KEEP})")
    check = commands.add_parser("verify", help="check that a backup still restores")
    check.add_argument("file", type=Path)
    back = commands.add_parser("restore", help="replace the live data with a backup")
    back.add_argument("file", type=Path)
    back.add_argument("--yes", action="store_true", help="really replace the live data")
    commands.add_parser("list", help="show the backups there are")
    args = parser.parse_args(argv)

    try:
        if args.command == "list":
            found = list_backups(args.dir)
            for item in found:
                print(f"{item['file']}  {item['bytes']:>10,} bytes  {_rows(item['tables'])}")
            print(f"{len(found)} backup(s) in {args.dir}")
            return 0

        postgres = Postgres(args.container or default_container())
        if args.command == "backup":
            manifest = backup(postgres, args.dir, keep=args.keep)
            print(f"Backup written and restore-tested: {args.dir / manifest['file']}")
            print(f"  {manifest['bytes']:,} bytes; {_rows(manifest['tables'])}")
            if manifest["removed"]:
                print(f"  removed {len(manifest['removed'])} old backup(s), keeping the newest {args.keep}")
        elif args.command == "verify":
            print(f"{args.file.name} restores cleanly: {_rows(verify(postgres, args.file))}")
        elif args.command == "restore":
            if not args.yes:
                print(f"This would REPLACE the live data in the database with {args.file.name}.")
                print("Nothing was changed. Run again with --yes to go ahead (a safety backup is taken first).")
                return 2
            result = restore(postgres, args.file, args.dir)
            print(f"Restored {args.file.name}.")
            print(f"  before: {_rows(result['before'])}")
            print(f"  after:  {_rows(result['after'])}")
            print(f"  the data as it was is in {args.dir / result['safety_backup']}")
        return 0
    except BackupError as problem:
        print(f"ERROR: {problem}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
