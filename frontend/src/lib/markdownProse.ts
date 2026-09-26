/** Apply `fn` to the prose of a markdown string, leaving code untouched:
 *  fenced blocks (``` or ~~~) and single-line inline code spans pass through
 *  exactly as written. Shared by the rewrites that run before the markdown
 *  renderer (math delimiters, citation links), which must never alter code. */
export function mapOutsideCode(src: string, fn: (prose: string) => string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;

  const flushProse = () => {
    if (prose.length) out.push(mapInlineProse(prose.join("\n"), fn));
    prose = [];
  };

  for (const line of src.split("\n")) {
    if (fence) {
      out.push(line);
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) {
      flushProse();
      fence = open[1];
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return out.join("\n");
}

function mapInlineProse(text: string, fn: (prose: string) => string): string {
  // Odd indexes are inline code spans — passed through untouched.
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join("");
}
