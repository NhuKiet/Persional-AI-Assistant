import pathlib


# core/settings.py la ranh gioi config — noi DUY NHAT duoc phep doc environment,
# va docstring cua no co nhac ten os.getenv. Moi module khac phai di qua no.
_CONFIG_BOUNDARY = "core/settings.py"


def _source_files():
    """Moi module trong tools/ va core/, tru ranh gioi config.

    Truoc day day la danh sach path cung, nen file moi (hoac file duoc tach ra)
    lang le nam ngoai pham vi kiem. Quet thu muc de khong the sot.
    """
    root = pathlib.Path(__file__).resolve().parent.parent
    for pkg in ("tools", "core"):
        for f in sorted((root / pkg).rglob("*.py")):
            if "__pycache__" in f.parts:
                continue
            rel = f.relative_to(root)
            if str(rel).replace("\\", "/") == _CONFIG_BOUNDARY:
                continue
            yield rel, f


def test_no_stray_os_getenv_in_migrated_modules():
    """Config phai doc qua core.settings, khong rai os.getenv."""
    offenders = []
    for rel, path in _source_files():
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "os.getenv" in line:
                offenders.append(f"{rel}:{i}")
    assert not offenders, f"os.getenv con sot: {offenders}"


def test_scan_actually_covers_the_split_search_package():
    """Chan viec pham vi quet lang le thu hep khi file duoc tach ra.

    Research domain (tools/search/*, tools/knowledge_store.py, ...) da chuyen
    sang backend/app/features/research/ (pure move, xem git history). Anchor
    lai bang cac file con lai trong tools/ va core/ de bai test van con y nghia.
    """
    scanned = {str(rel).replace("\\", "/") for rel, _ in _source_files()}
    for expected in ("tools/code_executor.py", "tools/coding_agent.py",
                     "tools/conversation.py", "tools/pdf_processor.py",
                     "core/llm.py", "core/pdf_context.py"):
        assert expected in scanned, f"{expected} nam ngoai pham vi quet"
    assert _CONFIG_BOUNDARY not in scanned, "ranh gioi config phai duoc mien tru"
