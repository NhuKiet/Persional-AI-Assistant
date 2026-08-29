interface MarkdownProps {
  text: string;
}

type Segment =
  | { type: "prose"; text: string }
  | { type: "code"; lang: string; text: string };

/** Tách fenced code block ra TRƯỚC khi chạy regex prose.
 *
 *  Bộ regex bên dưới không có khái niệm "khối" — nó thay thế theo dòng và
 *  biến "\n" thành <br/>, nên mọi thứ nằm trong ``` sẽ mất canh cột (sơ đồ
 *  ASCII, bảng, code) và bản thân dấu ``` lọt ra thành text thường. */
function segment(src: string): Segment[] {
  const out: Segment[] = [];
  const lines = src.split("\n");
  let prose: string[] = [];
  let code: string[] | null = null;
  let lang = "";

  const flushProse = () => {
    if (prose.join("\n").trim()) out.push({ type: "prose", text: prose.join("\n") });
    prose = [];
  };

  for (const line of lines) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      if (code === null) {
        flushProse();
        code = [];
        lang = fence[1].trim();
      } else {
        out.push({ type: "code", lang, text: code.join("\n") });
        code = null;
        lang = "";
      }
      continue;
    }
    (code ?? prose).push(line);
  }

  // Fence chưa đóng — hoặc đang stream dở, hoặc LLM quên đóng. Render phần đã
  // có như code block thay vì để nó nháy lên dưới dạng text thô rồi mới đổi.
  if (code !== null) out.push({ type: "code", lang, text: code.join("\n") });
  else flushProse();

  return out;
}

function renderProse(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>").replace(/^## (.+)$/gm, "<h2>$1</h2>").replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>").replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br/>");
}

export function Markdown({ text }: MarkdownProps) {
  return (
    <div className="md">
      {segment(text).map((seg, i) =>
        seg.type === "code" ? (
          // Nội dung code đi qua React children nên được escape sẵn — không
          // dùng dangerouslySetInnerHTML ở nhánh này.
          <pre className="md-pre" key={i} data-lang={seg.lang || undefined}>
            <code>{seg.text}</code>
          </pre>
        ) : (
          <div key={i} dangerouslySetInnerHTML={{ __html: `<p>${renderProse(seg.text)}</p>` }} />
        )
      )}
    </div>
  );
}
