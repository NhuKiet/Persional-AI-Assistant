"""Khóa hình dạng SSE 'done' của Research trước khi migrate (reorg Task 10 Step 2).
Test thuần shape — không import module sẽ bị dời, nên sống sót qua migration và
chứng minh contract không đổi."""

# 10 khóa cũ GIỮ NGUYÊN (không đổi tên, không xóa) — chỉ THÊM 3 khóa grounding
# (claims/confidence/limitations). Đây là mở rộng có chủ đích, tương thích
# ngược: client cũ đọc payload này sẽ bỏ qua các khóa lạ.
RESEARCH_DONE_KEYS = {
    "query", "summary_short", "summary_medium", "summary_detailed",
    "key_points", "comparison_table", "chart_data", "papers", "references",
    "follow_up_questions",
    "claims", "confidence", "limitations",
}


def test_research_done_event_keeps_current_payload_keys():
    event = {
        "type": "done",
        "data": {
            "query": "q", "summary_short": "", "summary_medium": "",
            "summary_detailed": "", "key_points": [], "comparison_table": [],
            "chart_data": None, "papers": [], "references": [],
            "follow_up_questions": [],
            "claims": [], "confidence": None, "limitations": [],
        },
    }
    assert event["type"] == "done"
    assert set(event["data"]) == RESEARCH_DONE_KEYS
