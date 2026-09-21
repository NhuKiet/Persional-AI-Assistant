"""Base dùng chung cho mọi test double của `Synthesizer`.

Lý do tồn tại: `ResearchAgent.run_streaming` KHÔNG gọi `synthesize_grounded`
nữa — nó gọi `synthesize_grounded_streaming`, bản yield `(out, step_name)` sau
mỗi section để SSE điền dần câu trả lời thay vì im lặng suốt cả pass 6-7 call
(xem `synthesizer.synthesize_grounded_streaming`). Fake nào chỉ định nghĩa bản
blocking cũ sẽ ném `AttributeError` ngay giữa `run_streaming`; agent nuốt lỗi
đó thành một event lỗi, nên test không đỏ ở chỗ gọi sai mà đỏ ở một assert
chẳng liên quan phía sau ("không thấy event done", "nguồn không được lưu") —
rất tốn thời gian truy ngược.

Kế thừa base này thì fake chỉ cần định nghĩa `synthesize_grounded` như cũ, còn
bản streaming được map sẵn thành một lần yield duy nhất. Khớp hợp đồng thật ở
điểm quan trọng nhất với phía gọi: yield CUỐI mang `step_name == "grounding"`.
"""


class StreamingSynthFake:
    """Map `synthesize_grounded` (blocking) -> `synthesize_grounded_streaming`.

    Fake nào cần mô phỏng nhiều section rơi về từng đợt thì override thẳng
    `synthesize_grounded_streaming` và yield nhiều lần; base này chỉ lo trường
    hợp phổ biến "một phát ra kết quả cuối".
    """

    def synthesize_grounded_streaming(self, query, sources):
        yield self.synthesize_grounded(query, sources), "grounding"
