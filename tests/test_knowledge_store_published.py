import datetime

from backend.app.features.research.knowledge_store import published_epoch_from_extra


def test_arxiv_full_date_yields_exact_epoch():
    at, year = published_epoch_from_extra({"published": "2024-03-15", "year": 2024})
    assert year == 2024
    assert at == datetime.datetime(2024, 3, 15).timestamp()


def test_year_only_yields_zero_epoch_and_year():
    at, year = published_epoch_from_extra({"year": 2023})
    assert at == 0
    assert year == 2023


def test_missing_metadata_yields_zeros():
    assert published_epoch_from_extra({}) == (0, 0)


def test_unparseable_date_falls_back_to_year():
    at, year = published_epoch_from_extra({"published": "khong-phai-ngay", "year": 2022})
    assert at == 0
    assert year == 2022


def test_garbage_year_is_ignored():
    assert published_epoch_from_extra({"year": "khong-phai-so"}) == (0, 0)


def test_none_extra_is_safe():
    assert published_epoch_from_extra(None) == (0, 0)
