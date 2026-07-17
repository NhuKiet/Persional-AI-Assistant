"""core/pdf_context.py — dựng nội dung message đa phương thức cho PDF chat.

Pin do người dùng khoanh vùng trên PDF (bôi đen text hoặc kéo khung ảnh). Hàm thuần,
không I/O. Trả string khi không có ảnh (giữ đường cũ, provider nào cũng chạy); trả
list content-block khi có ảnh để LangChain gửi cho vision model.
"""
from __future__ import annotations

__all__ = ["build_multimodal_content", "has_image_pin"]


def has_image_pin(pins: list[dict]) -> bool:
    """Có pin ảnh DÙNG ĐƯỢC không.

    Đòi luôn `data_url` để vị từ này khớp với thứ `build_multimodal_content`
    thực sự gắn vào message. Nếu chỉ xét `type == "image"`, một pin ảnh hỏng
    (thiếu data_url) sẽ vừa kích hoạt vision guard vừa không sinh block ảnh
    nào — model nhận lời dẫn "có ảnh" mà chẳng có ảnh.
    """
    return any(p.get("type") == "image" and p.get("data_url") for p in (pins or []))


def _format_text_pins(pins: list[dict]) -> str:
    parts = []
    for p in pins:
        if p.get("type") == "text":
            page = p.get("page", "?")
            text = (p.get("text") or "").strip()
            if text:
                parts.append(f'[Trích trang {page}] "{text}"')
    return "\n".join(parts)


def build_multimodal_content(
    user_text: str,
    doc_context: str,
    pins: list[dict] | None = None,
) -> str | list[dict]:
    pins = pins or []
    text_pins = _format_text_pins(pins)

    text_block = f"[Ngữ cảnh từ tài liệu]\n{doc_context}\n"
    if text_pins:
        text_block += f"\n[Vùng người dùng khoanh]\n{text_pins}\n"
    text_block += f"\n{user_text}"

    if not has_image_pin(pins):
        return text_block

    blocks: list[dict] = [{"type": "text", "text": text_block}]
    for p in pins:
        if p.get("type") == "image" and p.get("data_url"):
            blocks.append({
                "type": "image_url",
                "image_url": {"url": p["data_url"]},
            })
    return blocks
