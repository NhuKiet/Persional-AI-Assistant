import os

import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "supabase_integration: requires a local Supabase Postgres (supabase start); "
        "auto-skipped unless SUPABASE_TEST_DATABASE_URL is set.",
    )


def pytest_collection_modifyitems(config, items):
    if os.environ.get("SUPABASE_TEST_DATABASE_URL"):
        return
    skip = pytest.mark.skip(reason="SUPABASE_TEST_DATABASE_URL not set — run `supabase start` and export it to run these")
    for item in items:
        if "supabase_integration" in item.keywords:
            item.add_marker(skip)
