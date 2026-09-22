import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface LatexPreviewProps {
  latex: string;
}

/** Renders the recognized expression, or says why it could not be rendered.
 *
 * The model emits space-separated vocabulary tokens (`\frac { 1 } { 2 }`),
 * which is valid LaTeX — but a partially-recognized expression frequently is
 * not (an unclosed brace, a stray `^`). KaTeX is therefore run with
 * throwOnError: false and the failure is shown as a normal outcome rather
 * than crashing the page: "the model produced something KaTeX cannot draw"
 * is information the user needs, not an error to hide.
 */
export function LatexPreview({ latex }: LatexPreviewProps) {
  const { html, error } = useMemo(() => {
    if (!latex.trim()) return { html: "", error: "" };
    try {
      return {
        html: katex.renderToString(latex, {
          displayMode: true,
          throwOnError: false,
          errorColor: "var(--danger, #c0392b)",
        }),
        error: "",
      };
    } catch (err) {
      return { html: "", error: err instanceof Error ? err.message : String(err) };
    }
  }, [latex]);

  if (!latex.trim()) {
    return (
      <p className="hmer-empty">
        Mô hình chạy xong nhưng không đưa ra giả thuyết nào cho ảnh này.
      </p>
    );
  }

  if (error) {
    return <p className="hmer-empty">Không dựng được công thức: {error}</p>;
  }

  return (
    <div
      className="hmer-render"
      // KaTeX output is generated here from the model's own token string, not
      // from anything a third party supplied.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default LatexPreview;
