import { describe, expect, it } from "vitest";
import { pdfDeleteUrl, pdfRawUrl } from "./pdfUrls";

describe("pdf URL builders", () => {
  it("encodes special characters in the filename for the raw-file URL", () => {
    const filename = "báo cáo #1 (final)&draft.pdf";
    const url = pdfRawUrl(filename);

    expect(url).toContain(encodeURIComponent(filename));
    expect(url).not.toContain(" ");
    expect(url).not.toMatch(/#1 \(/);
  });

  it("encodes both filename and session id for the delete URL", () => {
    const filename = "q&a notes.pdf";
    const sessionId = "sess #7/weird";
    const url = pdfDeleteUrl(filename, sessionId);

    expect(url).toContain(encodeURIComponent(filename));
    expect(url).toContain(`session_id=${encodeURIComponent(sessionId)}`);
    expect(url).not.toContain(" ");
  });
});
