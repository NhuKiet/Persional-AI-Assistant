from backend.app.core.config import Settings


def test_news_settings_have_sane_defaults():
    s = Settings(_env_file=None)
    assert s.NEWS_REFRESH_INTERVAL_SECONDS == 6 * 3600
    assert s.NEWS_MANUAL_COOLDOWN_SECONDS == 60
    assert s.NEWS_MAX_ITEMS_PER_FEED == 20
    assert s.NEWS_MAX_ITEM_AGE_DAYS == 14
    assert s.NEWS_MAX_NEW_ITEMS_PER_RUN == 100
    assert s.NEWS_DESCRIPTION_TRUNCATE_CHARS == 1800
