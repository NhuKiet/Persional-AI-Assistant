import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
