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


def test_short_keyword_does_not_match_inside_a_word():
    assert has_compare_intent("devs đang xây gì với RAG") is False
    assert has_compare_intent("revs per minute in engine telemetry") is False
    assert has_compare_intent("convs and pooling layers") is False


def test_vs_still_matches_as_a_standalone_word():
    assert has_compare_intent("DPO vs PPO") is True
    assert has_compare_intent("RAG vs. fine-tuning") is True
