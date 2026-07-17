import { useState } from "react";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  isFix?: boolean;
  iteration?: number;
}

export function CodeBlock({ code, language = "python", filename, isFix, iteration }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const highlight = (src: string) => {
    const keywords = /\b(def|class|import|from|return|if|else|elif|for|while|try|except|with|as|in|not|and|or|True|False|None|print|lambda|yield|async|await|pass|break|continue|raise|global|nonlocal)\b/g;
    const strings  = /("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"\n]*"|'[^'\n]*')/g;
    const comments = /(#[^\n]*)/g;
    const numbers  = /\b(\d+\.?\d*)\b/g;
    return src
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(strings,  s => `<span class="sh-str">${s}</span>`)
      .replace(comments, c => `<span class="sh-cmt">${c}</span>`)
      .replace(keywords, k => `<span class="sh-kw">${k}</span>`)
      .replace(numbers,  n => `<span class="sh-num">${n}</span>`);
  };

  return (
    <div className={`code-block ${isFix ? "code-block-fix" : ""}`}>
      <div className="code-block-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="code-lang">{language}</span>
          {filename && <span className="code-filename">{filename}</span>}
          {isFix && <span className="code-fix-badge">fix #{iteration}</span>}
        </div>
        <button className="code-copy-btn" onClick={copy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <pre className="code-pre">
        <code dangerouslySetInnerHTML={{ __html: highlight(code) }} />
      </pre>
    </div>
  );
}

//Output code
