"""Coding page: sandbox status up front, and a table preview of uploaded data.

The status endpoint lets the page say "code can't run: Docker is off" before
the user spends a whole plan-and-generate round finding out. The preview is
the look at columns and first rows you take before asking for an analysis,
and its column list goes into the prompt so generated code uses real names.
"""
import io
import json
import subprocess

import pytest
from fastapi.testclient import TestClient

import backend.app.features.coding.execution as ce
from backend.app.core import capabilities
from backend.app.core.config import settings
from backend.app.core.csrf import CLIENT_HEADER
from backend.app.features.coding.data_preview import MAX_CELL_CHARS, MAX_COLUMNS, describe_table, table_preview
from backend.app.features.coding.service import _build_file_context
from main import app


@pytest.fixture
def client():
    return TestClient(app, headers={CLIENT_HEADER: "test"})


# ── sandbox status ──────────────────────────────────────────────────────


class _FakeDocker:
    """Stands in for the docker CLI: `docker info` and `docker image inspect`
    succeed or fail as configured, and every call is recorded."""

    def __init__(self, daemon=True, image=True):
        self.daemon, self.image = daemon, image
        self.calls: list[list[str]] = []

    def __call__(self, argv, **_kwargs):
        self.calls.append(argv)
        if argv[:2] == ["docker", "info"]:
            ok = self.daemon
        elif argv[:3] == ["docker", "image", "inspect"]:
            ok = self.daemon and self.image
        else:
            raise AssertionError(f"unexpected command {argv}")
        return subprocess.CompletedProcess(argv, 0 if ok else 1, b"", b"")


@pytest.fixture
def docker(monkeypatch):
    fake = _FakeDocker()
    monkeypatch.setattr(ce.subprocess, "run", fake)
    monkeypatch.setattr(ce, "_status_cache", None)
    clock = {"now": 1000.0}
    monkeypatch.setattr(ce.time, "monotonic", lambda: clock["now"])
    fake.clock = clock
    return fake


def test_status_ok_when_daemon_and_image_are_there(docker):
    status = ce.executor_status()

    assert status == ce.ExecutorStatus(True, "ok")
    assert ["docker", "image", "inspect", settings.EXECUTOR_IMAGE] in docker.calls
    assert capabilities.snapshot()["capabilities"]["executor"]["status"] == capabilities.OK


def test_status_says_docker_is_down(docker):
    docker.daemon = False

    status = ce.executor_status()

    assert status == ce.ExecutorStatus(False, "docker_unavailable")
    # No point asking about the image without a daemon.
    assert docker.calls == [["docker", "info"]]
    snap = capabilities.snapshot()["capabilities"]["executor"]
    assert snap["status"] == capabilities.DEGRADED
    assert snap["last_error"] == "docker_unavailable"


def test_status_says_the_image_was_never_built(docker):
    docker.image = False

    assert ce.executor_status() == ce.ExecutorStatus(False, "image_missing")


def test_starting_docker_is_noticed_without_a_restart(docker):
    # The old check ran once per process: Docker started after the backend
    # stayed "unavailable" until a restart.
    docker.daemon = False
    assert not ce.executor_status().available

    docker.daemon = True
    docker.clock["now"] += ce._TTL_UNAVAILABLE + 1

    assert ce.executor_status().available


def test_a_fresh_result_is_reused(docker):
    ce.executor_status()
    probes = len(docker.calls)
    docker.clock["now"] += ce._TTL_AVAILABLE - 1

    ce.executor_status()

    assert len(docker.calls) == probes


def test_refresh_probes_again_but_not_in_a_tight_loop(docker):
    docker.daemon = False
    ce.executor_status()
    probes = len(docker.calls)

    ce.executor_status(refresh=True)
    assert len(docker.calls) == probes  # clicked right away: same answer

    docker.clock["now"] += ce._MIN_PROBE_INTERVAL + 0.1
    docker.daemon = True
    assert ce.executor_status(refresh=True).available


def test_run_reports_a_missing_image_without_writing_code(monkeypatch, tmp_path):
    monkeypatch.setattr(ce, "executor_status", lambda **_: ce.ExecutorStatus(False, "image_missing"))

    result = ce.CodeExecutor().run("print(1)", sandbox=tmp_path)

    assert result.unavailable and result.reason_code == "image_missing"
    assert not list(tmp_path.glob("run_*.py"))


def test_status_endpoint(client, monkeypatch):
    seen = {}

    def fake_status(refresh=False):
        seen["refresh"] = refresh
        return ce.ExecutorStatus(False, "docker_unavailable")

    import backend.app.features.coding.router as coding_router
    monkeypatch.setattr(coding_router, "executor_status", fake_status)

    body = client.get("/api/coding/status?refresh=true").json()

    assert seen["refresh"] is True
    assert body["executor"] == {
        "available": False,
        "reason": "docker_unavailable",
        "image": settings.EXECUTOR_IMAGE,
        "timeout_s": settings.CODE_TIMEOUT,
        "memory": settings.EXECUTOR_MEMORY,
        "network": False,
    }


# ── table preview ───────────────────────────────────────────────────────


CSV = (
    "id,name,score,passed,joined\n"
    "1,An,8.5,true,2024-01-03\n"
    "2,Bình,7,false,2024-02-11\n"
    "3,Chi,,true,2024-03-20\n"
    "4,Dũng,9.25,false,2024-04-02\n"
    "5,Em,6,true,2024-05-15\n"
    "6,Giang,8,true,2024-06-30\n"
)


def _types(table):
    return {c["name"]: c["type"] for c in table["columns"]}


def test_csv_preview_has_columns_types_totals_and_first_rows():
    table = table_preview(".csv", CSV.encode())

    assert _types(table) == {"id": "int", "name": "text", "score": "float", "passed": "bool", "joined": "date"}
    assert table["total_rows"] == 6
    assert table["total_columns"] == 5
    assert len(table["rows"]) == 5
    assert table["rows"][0] == ["1", "An", "8.5", "true", "2024-01-03"]


def test_csv_from_excel_with_bom_and_semicolons():
    content = "﻿mã;tên\nA1;Táo\nA2;Lê\n".encode("utf-8")

    table = table_preview(".csv", content)

    assert [c["name"] for c in table["columns"]] == ["mã", "tên"]
    assert table["total_rows"] == 2


def test_ragged_rows_and_blank_lines():
    table = table_preview(".csv", b"a,b,c\n1,2\n\n3,4,5,6\n")

    assert table["total_rows"] == 2
    assert table["rows"] == [["1", "2", None], ["3", "4", "5"]]


def test_tsv_json_and_jsonl():
    tsv = table_preview(".tsv", b"x\ty\n1\thello\n")
    assert _types(tsv) == {"x": "int", "y": "text"}

    records = [{"city": "Huế", "pop": 652572}, {"city": "Đà Nẵng", "pop": 1220190, "coast": True}]
    as_json = table_preview(".json", json.dumps(records).encode())
    assert [c["name"] for c in as_json["columns"]] == ["city", "pop", "coast"]
    assert as_json["rows"][0] == ["Huế", 652572, None]
    assert as_json["total_rows"] == 2

    jsonl = table_preview(".jsonl", "\n".join(json.dumps(r) for r in records).encode())
    assert jsonl["total_rows"] == 2 and _types(jsonl)["pop"] == "int"


def test_xlsx_first_sheet():
    from openpyxl import Workbook

    book = Workbook()
    sheet = book.active
    sheet.title = "Doanh thu"
    sheet.append(["tháng", "doanh thu"])
    for month in range(1, 8):
        sheet.append([month, month * 1.5])
    book.create_sheet("Ghi chú")
    buffer = io.BytesIO()
    book.save(buffer)

    table = table_preview(".xlsx", buffer.getvalue())

    assert _types(table) == {"tháng": "int", "doanh thu": "float"}
    assert table["total_rows"] == 7
    assert table["rows"][0] == [1, 1.5]
    assert table["sheet"] == "Doanh thu (1/2 sheet)"


def test_parquet_uses_its_own_schema():
    import pyarrow as pa
    import pyarrow.parquet as pq

    buffer = io.BytesIO()
    pq.write_table(pa.table({"id": list(range(12)), "label": [f"l{i}" for i in range(12)]}), buffer)

    table = table_preview(".parquet", buffer.getvalue())

    assert _types(table) == {"id": "int", "label": "text"}
    assert table["total_rows"] == 12
    assert table["rows"][:2] == [[0, "l0"], [1, "l1"]]


def test_wide_tables_and_long_cells_are_cut_to_fit():
    header = ",".join(f"c{i}" for i in range(MAX_COLUMNS + 5))
    row = ",".join(["x" * 500] + ["1"] * (MAX_COLUMNS + 4))

    table = table_preview(".csv", f"{header}\n{row}\n".encode())

    assert len(table["columns"]) == MAX_COLUMNS
    assert table["total_columns"] == MAX_COLUMNS + 5
    assert len(table["rows"][0]) == MAX_COLUMNS
    assert len(table["rows"][0][0]) == MAX_CELL_CHARS


@pytest.mark.parametrize("suffix,content", [
    (".json", b'{"not": "a table"}'),
    (".json", b"not json at all"),
    (".xlsx", b"not a zip"),
    (".parquet", b"PAR1 garbage"),
    (".txt", b"just some notes"),
    (".xls", b"legacy excel"),
    (".csv", b""),
])
def test_what_isnt_a_readable_table_gets_no_preview(suffix, content):
    assert table_preview(suffix, content) is None


def test_upload_returns_the_table_and_no_host_path(client, monkeypatch, tmp_path):
    import backend.app.features.coding.uploads as uploads

    monkeypatch.setattr(uploads, "SANDBOX_DIR", tmp_path)

    body = client.post(
        "/api/coding/upload",
        files={"file": ("grades.csv", CSV.encode(), "text/csv")},
        data={"session_id": "s1"},
    ).json()

    assert body["name"] == "grades.csv"
    assert body["table"]["total_rows"] == 6
    assert "path" not in body
    assert str(tmp_path) not in json.dumps(body)


def test_a_broken_table_still_uploads(client, monkeypatch, tmp_path):
    import backend.app.features.coding.uploads as uploads

    monkeypatch.setattr(uploads, "SANDBOX_DIR", tmp_path)

    response = client.post(
        "/api/coding/upload",
        files={"file": ("broken.xlsx", b"not a zip", "application/octet-stream")},
        data={"session_id": "s1"},
    )

    assert response.status_code == 200
    assert response.json()["table"] is None


# ── into the prompt ─────────────────────────────────────────────────────


def test_prompt_gets_the_real_column_names():
    table = table_preview(".csv", CSV.encode())

    context = _build_file_context([{"name": "grades.csv", "size": 180, "preview": "", "table": table}])

    assert "Table: 6 rows × 5 columns: id (int), name (text), score (float), passed (bool), joined (date)" in context


def test_prompt_survives_a_mangled_table_from_the_browser():
    # `table` comes back from the client with each request: never trusted.
    for junk in (None, "x", 3, {"columns": "nope"}, {"columns": [1, 2]}, {"columns": [{"name": "a"}], "total_rows": "many"}):
        describe_table(junk)  # must not raise
        _build_file_context([{"name": "f.csv", "size": 1, "table": junk}])
