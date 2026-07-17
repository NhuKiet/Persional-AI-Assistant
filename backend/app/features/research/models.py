import hashlib
from dataclasses import dataclass, field


@dataclass
class SearchResult:
    source: str
    title: str
    url: str
    content: str
    score: float = 1.0
    extra: dict = field(default_factory=dict)
    id: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = hashlib.sha256(f"{self.url}|{self.title}".encode()).hexdigest()[:16]


@dataclass
class Claim:
    text: str
    source_ids: list[str]
    evidence_type: str = "uncertain"   # "direct" | "inference" | "opinion" | "uncertain"
    grounded: bool = True


@dataclass
class ResearchOutput:
    query: str
    summary_short: str = ""
    summary_medium: str = ""
    summary_detailed: str = ""
    key_points: list[str] = field(default_factory=list)
    comparison_table: list[dict] = field(default_factory=list)
    chart_data: dict | None = None
    papers: list[dict] = field(default_factory=list)
    references: list[dict] = field(default_factory=list)
    follow_up_questions: list[str] = field(default_factory=list)
    claims: list[Claim] = field(default_factory=list)
    confidence: float | None = None
    limitations: list[str] = field(default_factory=list)
