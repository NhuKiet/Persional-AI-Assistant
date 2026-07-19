import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// new URL("../../styles/x.css", import.meta.url) resolves against the jsdom
// test environment's location (http://localhost:5173/...) instead of the
// file:// module URL under this repo's Vitest+jsdom config, which makes
// readFileSync throw "The URL must be of scheme file". Resolve via
// fileURLToPath + path.join instead so the path stays anchored to this file
// on disk regardless of jsdom's global URL/location shims.
const dir = path.dirname(fileURLToPath(import.meta.url));
const pdfCss = readFileSync(path.join(dir, "../../styles/pdf.css"), "utf8");
const responsiveCss = readFileSync(path.join(dir, "../../styles/responsive.css"), "utf8");

describe("PDF workspace CSS contract", () => {
  it("uses the PDF accent token and defines the approved responsive modes", () => {
    expect(pdfCss).toContain("var(--accent-pdf)");
    expect(pdfCss).toContain(".pdf-workspace");
    expect(responsiveCss).toContain("@media (max-width: 1279px)");
    expect(responsiveCss).toContain("@media (max-width: 899px)");
  });

  // Regression guard: PdfToolbar/PdfOutline/PdfSearch/PdfAssistantPanel
  // render real DOM (buttons, lists, inputs) with no className of their own
  // beyond a few wrapper hooks — the workspace shell (Task 8) styled only
  // the container panels, leaving every control inside them as unstyled
  // browser-default HTML. Assert the descendant selectors that style that
  // content actually exist, so this can't silently regress to bare markup
  // again.
  it("styles the toolbar, outline, search bar, and assistant info bar content", () => {
    expect(pdfCss).toContain(".pdf-toolbar {");
    expect(pdfCss).toContain(".pdf-toolbar button");
    expect(pdfCss).toContain(".pdf-outline-panel button");
    expect(pdfCss).toContain(".pdf-outline-panel button[aria-current=\"page\"]");
    expect(pdfCss).toContain(".pdf-search-anchor");
    expect(pdfCss).toContain(".pdf-assistant-content");
    expect(pdfCss).toContain(".pdf-info-bar");
    expect(pdfCss).toContain(".pdf-summarize-btn");
  });
});
