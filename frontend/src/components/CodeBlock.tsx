import { CopyButton } from "./CopyButton";
import { HighlightedCode } from "./HighlightedCode";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  isFix?: boolean;
  iteration?: number;
}

export function CodeBlock({ code, language = "python", filename, isFix, iteration }: CodeBlockProps) {
  return (
    <div className={`code-block ${isFix ? "code-block-fix" : ""}`}>
      <div className="code-block-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="code-lang">{language}</span>
          {filename && <span className="code-filename">{filename}</span>}
          {isFix && <span className="code-fix-badge">fix #{iteration}</span>}
        </div>
        <CopyButton text={code} />
      </div>
      <pre className="code-pre">
        <code><HighlightedCode code={code} language={language} /></code>
      </pre>
    </div>
  );
}
