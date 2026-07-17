from backend.app.features.research.chunking import (
    category_for, build_parent_child, ParentChunk, CATEGORY_MAP,
)


def test_category_map_covers_sources():
    assert category_for("arxiv") == "academic"
    assert category_for("semantic") == "academic"
    assert category_for("openalex") == "academic"
    assert category_for("github") == "code"
    assert category_for("wiki") == "reference"
    assert category_for("web") == "web"
    assert category_for("huggingface") == "web"
    # unknown → default web
    assert category_for("totally-unknown") == "web"


def test_build_parent_child_no_heading_single_parent():
    text = "First sentence. " * 60  # ~ long, no markdown heading
    parents = build_parent_child(text, chunk_size=200, overlap=20)
    assert len(parents) == 1
    p = parents[0]
    assert isinstance(p, ParentChunk)
    assert p.heading == ""
    # long text must be split into multiple children
    assert len(p.children) >= 2
    # every child fits roughly within chunk_size (+ overlap tolerance)
    assert all(len(c) <= 200 + 50 for c in p.children)


def test_build_parent_child_splits_by_markdown_heading():
    text = (
        "# Intro\n"
        "This is the intro section with some words.\n\n"
        "## Details\n"
        "Here are the details of the second section.\n"
    )
    parents = build_parent_child(text, chunk_size=200, overlap=20)
    headings = {p.heading for p in parents}
    # both headings become separate parents
    assert any("Intro" in h for h in headings)
    assert any("Details" in h for h in headings)
    assert len(parents) == 2


def test_build_parent_child_empty_text():
    assert build_parent_child("", chunk_size=200, overlap=20) == []
    assert build_parent_child("   ", chunk_size=200, overlap=20) == []
