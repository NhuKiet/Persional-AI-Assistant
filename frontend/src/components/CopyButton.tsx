import { useEffect, useRef, useState } from "react";

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
  copiedLabel?: string;
}

/** Copy `text` to the clipboard and confirm for a moment. The clipboard API
 *  is permission-gated and can reject; the text stays on screen and
 *  selectable, so a failed copy just leaves the label unchanged. */
export function CopyButton({
  text,
  className = "code-copy-btn",
  label = "Copy",
  copiedLabel = "✓ Copied",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button type="button" className={className} onClick={copy} aria-label={copied ? copiedLabel : label}>
      {copied ? copiedLabel : label}
    </button>
  );
}
