import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MicButton } from "../components/MicButton";

const original = {
  SR: (window as any).SpeechRecognition,
  webkitSR: (window as any).webkitSpeechRecognition,
};

afterEach(() => {
  (window as any).SpeechRecognition = original.SR;
  (window as any).webkitSpeechRecognition = original.webkitSR;
});

it("ẩn khi trình duyệt không hỗ trợ", () => {
  (window as any).SpeechRecognition = undefined;
  (window as any).webkitSpeechRecognition = undefined;
  const { container } = render(<MicButton onTranscript={() => {}} />);
  expect(container.firstChild).toBeNull();
});

it("hiện nút mic khi hỗ trợ", () => {
  class FakeSR {
    lang = ""; continuous = false; interimResults = false;
    onresult: any = null; onend: any = null;
    start() {} stop() {}
  }
  (window as any).SpeechRecognition = FakeSR;
  render(<MicButton onTranscript={() => {}} />);
  expect(screen.getByRole("button", { name: /giọng nói/i })).toBeInTheDocument();
});

it("bật nghe: pulse + gọi onTranscript với transcript chốt", async () => {
  const instances: any[] = [];
  class FakeSR {
    lang = ""; continuous = false; interimResults = false;
    onresult: any = null; onend: any = null;
    start = vi.fn(); stop = vi.fn();
    constructor() { instances.push(this); }
  }
  (window as any).SpeechRecognition = FakeSR;
  const onTranscript = vi.fn();
  const user = userEvent.setup();
  render(<MicButton onTranscript={onTranscript} />);
  const btn = screen.getByRole("button", { name: /giọng nói/i });

  await user.click(btn);
  expect(instances[0].start).toHaveBeenCalled();
  expect(btn.className).toContain("mic-btn-active");

  // Recognizer trả kết quả chốt (isFinal) → hook nối transcript và gọi onTranscript.
  act(() => {
    instances[0].onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: "xin chào" }], { isFinal: true })],
    });
  });
  expect(onTranscript).toHaveBeenCalledWith("xin chào");

  // onend → dừng nghe, bỏ pulse.
  act(() => {
    instances[0].onend();
  });
  expect(btn.className).not.toContain("mic-btn-active");
});
