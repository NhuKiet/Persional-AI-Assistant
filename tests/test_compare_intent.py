# tests/test_compare_intent.py
from backend.app.features.research.search.query import has_compare_intent


def test_compare_intent_detected_in_vietnamese():
    assert has_compare_intent("so sánh DPO và PPO") is True
    assert has_compare_intent("DPO khác PPO ở điểm nào") is True


def test_compare_intent_detected_in_english():
    assert has_compare_intent("DPO vs PPO") is True
    assert has_compare_intent("difference between RAG and fine-tuning") is True


def test_no_compare_intent_on_plain_question():
    assert has_compare_intent("RAG hoạt động thế nào") is False
    assert has_compare_intent("what is mixture of experts") is False


def test_compare_intent_is_case_insensitive():
    assert has_compare_intent("Compare BERT And GPT") is True
