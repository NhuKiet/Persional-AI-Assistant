from backend.app.features.news.security import UNTRUSTED_GUARD, frame_untrusted


def test_frame_untrusted_wraps_content_with_markers():
    result = frame_untrusted("some RSS description")
    assert "[BEGIN UNTRUSTED SOURCE]" in result
    assert "[END UNTRUSTED SOURCE]" in result
    assert "some RSS description" in result


def test_frame_untrusted_empty_content_returns_empty():
    assert frame_untrusted("") == ""
    assert frame_untrusted("   ") == ""


def test_untrusted_guard_mentions_ignoring_embedded_instructions():
    assert "instructions" in UNTRUSTED_GUARD.lower()
