import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

interface MicButtonProps {
  /** Nhận đoạn text vừa nhận diện — caller nối vào ô nhập của mình. */
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function MicButton({ onTranscript, disabled }: MicButtonProps) {
  const { supported, listening, start, stop } = useSpeechRecognition({ onResult: onTranscript });
  if (!supported) return null;
  return (
    <button
      type="button"
      className={`mic-btn${listening ? " mic-btn-active" : ""}`}
      onClick={() => (listening ? stop() : start())}
      disabled={disabled}
      aria-label={listening ? "Dừng nhập giọng nói" : "Nhập bằng giọng nói"}
      title={listening ? "Dừng nghe" : "Nói để nhập"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.6"/>
        <path d="M5 11a7 7 0 0 0 14 0M12 18v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
    </button>
  );
}
