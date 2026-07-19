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
});
