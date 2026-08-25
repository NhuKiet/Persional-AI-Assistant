"""Curated RSS feed list for the news digest.

Each entry: (feed_url, source_label, topic). URLs were verified working as
of writing this module — blog RSS endpoints change without notice. If a
source starts failing consistently in the `[NEWS] fetch failed for ...`
logs, check whether ITS feed URL moved before assuming the fetcher broke.

Note: Anthropic (https://www.anthropic.com/rss.xml) and Meta
(https://ai.meta.com/blog/rss/) were removed from this list because both
endpoints return 404 — these companies do not currently publish official
RSS feeds. Rather than guess at replacement URLs (which proved equally
dead), we removed them outright. model_release topic is still covered by
OpenAI, Google DeepMind, and Hugging Face feeds. If either company starts
publishing an RSS feed again, it can be re-added.
"""

SOURCES: list[tuple[str, str, str]] = [
    ("https://openai.com/news/rss.xml",                     "OpenAI Blog",            "model_release"),
    ("https://deepmind.google/blog/rss.xml",                "Google DeepMind",        "model_release"),
    ("https://huggingface.co/blog/feed.xml",                "Hugging Face Blog",      "model_release"),
    ("http://export.arxiv.org/rss/cs.AI",                   "arXiv cs.AI",            "research"),
    ("http://export.arxiv.org/rss/cs.RO",                   "arXiv cs.RO",            "research"),
    ("https://spectrum.ieee.org/feeds/topic/robotics.rss",  "IEEE Spectrum Robotics", "robotics"),
    ("https://hnrss.org/newest?q=AI+OR+robotics&points=50", "Hacker News",            "community"),
]
