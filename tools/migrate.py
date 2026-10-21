"""Apply the database migrations in supabase/migrations/ to SUPABASE_DB_URL.

For a hosted Postgres (the Railway deploy) that is not managed by the
Supabase CLI. Locally, `supabase start` applies the same files itself and
records them in supabase_migrations.schema_migrations; this tool reads that
table as well, so pointing it at a CLI-managed database applies nothing twice.

- Files run in name order, each in its own transaction, and are recorded in
  public.king_schema_migrations: a file that fails leaves nothing behind and
  is retried on the next start.
- An advisory lock keeps two containers starting at once from applying the
  same file twice.
- No SUPABASE_DB_URL: nothing to migrate. The app still starts (chat history
  is then not saved), so this exits 0 with a warning rather than blocking it.

Usage:
  python tools/migrate.py
  python tools/migrate.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MIGRATIONS = REPO / "supabase" / "migrations"
_LOCK_KEY = 0x4B694E67  # "KiNg"

_CREATE_LEDGER = """
create table if not exists public.king_schema_migrations (
    version    text primary key,
    name       text not null,
    applied_at timestamptz not null default now()
)
"""


def migration_files(directory: Path = MIGRATIONS) -> list[tuple[str, Path]]:
    """(version, path) for every .sql file, oldest first. The version is the
    timestamp prefix before the first "_", as the Supabase CLI names them."""
    files = sorted(directory.glob("*.sql"))
    return [(path.name.split("_", 1)[0], path) for path in files]


def pending(files: list[tuple[str, Path]], applied: set[str]) -> list[tuple[str, Path]]:
    return [(version, path) for version, path in files if version not in applied]


def applied_versions(conn) -> set[str]:
    versions = {row[0] for row in conn.execute("select version from public.king_schema_migrations")}
    cli = conn.execute("select to_regclass('supabase_migrations.schema_migrations')").fetchone()[0]
    if cli is not None:
        versions |= {row[0] for row in conn.execute("select version from supabase_migrations.schema_migrations")}
    return versions


def migrate(conninfo: str, directory: Path = MIGRATIONS, dry_run: bool = False) -> list[str]:
    """Apply what is missing; returns the file names applied (or that would be)."""
    import psycopg

    done: list[str] = []
    with psycopg.connect(conninfo, autocommit=True, connect_timeout=15) as conn:
        conn.execute("select pg_advisory_lock(%s)", (_LOCK_KEY,))
        try:
            conn.execute(_CREATE_LEDGER)
            for version, path in pending(migration_files(directory), applied_versions(conn)):
                if not dry_run:
                    with conn.transaction():
                        conn.execute(path.read_text(encoding="utf-8"))
                        conn.execute(
                            "insert into public.king_schema_migrations (version, name) values (%s, %s)",
                            (version, path.name),
                        )
                done.append(path.name)
        finally:
            conn.execute("select pg_advisory_unlock(%s)", (_LOCK_KEY,))
    return done


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="list what would be applied, change nothing")
    args = parser.parse_args(argv)

    conninfo = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not conninfo:
        print("migrate: SUPABASE_DB_URL is not set — nothing to migrate.", file=sys.stderr)
        return 0
    try:
        done = migrate(conninfo, dry_run=args.dry_run)
    except Exception as error:  # noqa: BLE001 — report and fail the start
        print(f"migrate: FAILED — {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    verb = "would apply" if args.dry_run else "applied"
    print(f"migrate: {verb} {len(done)} migration(s){': ' + ', '.join(done) if done else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
