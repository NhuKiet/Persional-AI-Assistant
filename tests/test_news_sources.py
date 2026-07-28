from backend.app.features.news.sources import SOURCES

_VALID_TOPICS = {"model_release", "research", "robotics", "community"}


def test_sources_all_have_https_or_http_url():
    for feed_url, _source, _topic in SOURCES:
        assert feed_url.startswith(("https://", "http://")), feed_url


def test_sources_all_have_a_valid_topic():
    for feed_url, _source, topic in SOURCES:
        assert topic in _VALID_TOPICS, f"{feed_url} has invalid topic {topic!r}"


def test_sources_urls_are_unique():
    urls = [feed_url for feed_url, _, _ in SOURCES]
    assert len(urls) == len(set(urls))


def test_sources_covers_every_topic():
    topics_present = {topic for _, _, topic in SOURCES}
    assert topics_present == _VALID_TOPICS
