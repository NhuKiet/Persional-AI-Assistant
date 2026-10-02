"""Prompt-injection hardening: đóng khung nội dung nguồn không tin cậy.

Cài đặt nằm ở backend/app/shared/untrusted.py (dùng chung với news và pdf);
module này giữ lại tên cũ cho các import trong research/ và chat/.
"""
from backend.app.shared.untrusted import UNTRUSTED_GUARD, frame_untrusted

__all__ = ["UNTRUSTED_GUARD", "frame_untrusted"]
