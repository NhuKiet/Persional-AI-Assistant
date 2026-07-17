interface KeyPointProps {
  text: string;
}

export function KeyPoint({ text }: KeyPointProps) {
  const TAG_COLORS: Record<string, string> = { FINDING: "#7C9EFF", METHOD: "#A8E6A3", DATA: "#FFD085", TREND: "#E8A0FF", LIMITATION: "#FF8585", DEFINITION: "#85CFFF" };
  const match = text.match(/^\[(\w+)\]\s*(.*)/s);
  if (!match) return <li className="kp-item"><span className="kp-text">{text}</span></li>;
  const [, tag, body] = match;
  return (
    <li className="kp-item">
      <span className="kp-tag" style={{ color: TAG_COLORS[tag] || "#888", borderColor: (TAG_COLORS[tag] || "#888") + "44" }}>{tag}</span>
      <span className="kp-text">{body}</span>
    </li>
  );
}
