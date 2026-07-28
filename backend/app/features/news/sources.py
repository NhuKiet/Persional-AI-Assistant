"""Curated RSS feed list for the news digest.

Each entry: (feed_url, source_label, topic). URLs were verified working as
of writing this module — blog RSS endpoints change without notice. If a
source starts failing consistently in the `[NEWS] fetch failed for ...`
logs, check whether ITS feed URL moved before assuming the fetcher broke.
"""

SOURCES: list[tuple[str, str, str]] = [
    ("https://openai.com/news/rss.xml",                     "OpenAI Blog",            "model_release"),
    ("https://www.anthropic.com/rss.xml",                   "Anthropic News",         "model_release"),
    ("https://deepmind.google/blog/rss.xml",                "Google DeepMind",        "model_release"),
    ("https://ai.meta.com/blog/rss/",                       "Meta AI Blog",           "model_release"),
    ("https://huggingface.co/blog/feed.xml",                "Hugging Face Blog",      "model_release"),
    ("http://export.arxiv.org/rss/cs.AI",                   "arXiv cs.AI",            "research"),
    ("http://export.arxiv.org/rss/cs.RO",                   "arXiv cs.RO",            "research"),
    ("https://spectrum.ieee.org/feeds/topic/robotics.rss",  "IEEE Spectrum Robotics", "robotics"),
    ("https://hnrss.org/newest?q=AI+OR+robotics&points=50", "Hacker News",            "community"),
]
