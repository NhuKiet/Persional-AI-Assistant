"""tools/chunking.py — Parent-child chunking cho knowledge store.

Bước 1: markdown_split — tách theo heading (#..######).
Bước 2: recursive_split — cắt nhỏ trong mỗi section.
Bước 3: build_parent_child — mỗi section = 1 parent, các chunk nhỏ = children.

Logic thuần (không I/O) để test được không cần Weaviate/OpenAI.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from langchain_text_splitters import (
    MarkdownHeaderTextSplitter,
    RecursiveCharacterTextSplitter,
)

# source → category (4 nhóm cố định)
CATEGORY_MAP: dict[str, str] = {
    "arxiv":         "academic",
    "semantic":      "academic",
    "huggingface":   "web",
    "web":           "web",
    "duckduckgo":    "web",
    "stackoverflow": "code",
}


def category_for(source: str) -> str:
    return CATEGORY_MAP.get(source, "web")


@dataclass
class ParentChunk:
    content: str
    heading: str = ""
    children: list[str] = field(default_factory=list)


_HEADERS = [("#", "h1"), ("##", "h2"), ("###", "h3"),
            ("####", "h4"), ("#####", "h5"), ("######", "h6")]


def _markdown_sections(text: str) -> list[tuple[str, str]]:
    """Trả list (heading, section_text). Không có heading → [("", text)]."""
    if "#" not in text:
        return [("", text)]
    splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=_HEADERS, strip_headers=True,
    )
    docs = splitter.split_text(text)
    if not docs:
        return [("", text)]
    sections: list[tuple[str, str]] = []
    for d in docs:
        heading = " / ".join(
            v for k, v in d.metadata.items() if v
        )
        sections.append((heading, d.page_content))
    return sections


def build_parent_child(text: str, chunk_size: int, overlap: int) -> list[ParentChunk]:
    if not text or not text.strip():
        return []

    recursive = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    parents: list[ParentChunk] = []
    for heading, section in _markdown_sections(text):
        section = section.strip()
        if not section:
            continue
        children = [c.strip() for c in recursive.split_text(section) if c.strip()]
        if not children:
            children = [section]
        parents.append(ParentChunk(content=section, heading=heading, children=children))
    return parents
