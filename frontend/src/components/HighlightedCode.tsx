import { isPython, tokenizePython } from "../lib/highlight";

/** Code text with Python tokens wrapped in `sh-*` spans. Other languages
 *  render as plain text: no highlighter beats a wrong one. */
export function HighlightedCode({ code, language }: { code: string; language?: string }) {
  if (!isPython(language)) return <>{code}</>;
  return (
    <>
      {tokenizePython(code).map((t, i) =>
        t.kind === "plain" ? t.text : <span key={i} className={`sh-${t.kind}`}>{t.text}</span>,
      )}
    </>
  );
}
