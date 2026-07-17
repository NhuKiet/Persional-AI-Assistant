# tests/test_pdf_context.py
from core.pdf_context import build_multimodal_content, has_image_pin


def test_no_pins_returns_string():
    out = build_multimodal_content("Câu hỏi?", "DOC_CTX", [])
    assert isinstance(out, str)
    assert "DOC_CTX" in out
    assert "Câu hỏi?" in out


def test_has_image_pin():
    assert has_image_pin([{"type": "image", "page": 1, "data_url": "d"}]) is True
    assert has_image_pin([{"type": "text", "page": 1, "text": "x"}]) is False
    assert has_image_pin([]) is False


def test_text_pin_embedded_with_page():
    pins = [{"type": "text", "page": 3, "text": "đoạn quan trọng"}]
    out = build_multimodal_content("giải thích", "DOC_CTX", pins)
    assert isinstance(out, str)
    assert "[Trích trang 3]" in out
    assert "đoạn quan trọng" in out


def test_image_pin_returns_blocks():
    pins = [{"type": "image", "page": 2, "data_url": "data:image/jpeg;base64,AAA"}]
    out = build_multimodal_content("cái này là gì", "DOC_CTX", pins)
    assert isinstance(out, list)
    imgs = [b for b in out if b["type"] == "image_url"]
    assert len(imgs) == 1
    assert imgs[0]["image_url"]["url"] == "data:image/jpeg;base64,AAA"
    texts = [b for b in out if b["type"] == "text"]
    assert texts and "DOC_CTX" in texts[0]["text"]
    assert "cái này là gì" in texts[0]["text"]


def test_mixed_pins_image_and_text():
    pins = [
        {"type": "text", "page": 1, "text": "định nghĩa A"},
        {"type": "image", "page": 2, "data_url": "data:image/jpeg;base64,BBB"},
    ]
    out = build_multimodal_content("hỏi", "CTX", pins)
    assert isinstance(out, list)
    assert [b for b in out if b["type"] == "image_url"][0]["image_url"]["url"].endswith("BBB")
    assert "[Trích trang 1]" in [b for b in out if b["type"] == "text"][0]["text"]


def test_image_pin_without_data_url_is_not_an_image_pin():
    """Pin anh hong khong duoc kich hoat nhanh vision.

    has_image_pin phai khop voi thu build_multimodal_content that su gan vao:
    khong co data_url => khong co block anh => khong coi la co anh.
    """
    pins = [{"type": "image", "page": 1}]          # thieu data_url
    assert has_image_pin(pins) is False
    out = build_multimodal_content("hoi", "CTX", pins)
    assert isinstance(out, str)                     # tra string, khong phai block list


def test_image_pin_with_empty_data_url_is_not_an_image_pin():
    pins = [{"type": "image", "page": 1, "data_url": ""}]
    assert has_image_pin(pins) is False
    assert isinstance(build_multimodal_content("hoi", "CTX", pins), str)
