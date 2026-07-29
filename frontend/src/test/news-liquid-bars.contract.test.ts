import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const newsCss = readFileSync(path.join(srcDirectory, "styles/news.css"), "utf8");
const newsPage = readFileSync(path.join(srcDirectory, "pages/NewsPage.tsx"), "utf8");

describe("Layered News interface contract", () => {
  it("uses the demo's original material and the approved tuned material", () => {
    expect(newsCss).toMatch(/\.news-page\s*\{[\s\S]*--news-tint:\s*rgba\(255, 255, 255, 0\.5\);/);
    expect(newsCss).toMatch(/--news-blur:\s*3px;/);
    expect(newsCss).toMatch(
      /\.news-layered-tuned\s*\{[\s\S]*--news-tint:\s*rgba\(255, 255, 255, 0\.17\);/,
    );
    expect(newsCss).toMatch(/\.news-layered-tuned\s*\{[\s\S]*--news-blur:\s*1\.25px;/);
    expect(newsPage).toMatch(/original:\s*\{\s*tint:\s*"50%",\s*blur:\s*"3px",\s*scale:\s*77\s*\}/);
    expect(newsPage).toMatch(/tuned:\s*\{\s*tint:\s*"17%",\s*blur:\s*"1\.25px",\s*scale:\s*46\s*\}/);
  });

  it("keeps the four-layer order separate from readable content", () => {
    expect(newsPage).toMatch(
      /news-glass-effect[\s\S]*news-glass-tint[\s\S]*news-glass-shine/,
    );
    expect(newsCss).toMatch(
      /\.news-glass-effect,[\s\S]*\.news-glass-tint,[\s\S]*\.news-glass-shine\s*\{[\s\S]*position:\s*absolute;[\s\S]*pointer-events:\s*none;/,
    );
    expect(newsCss).toMatch(
      /\.news-glass-effect\s*\{[\s\S]*backdrop-filter:\s*blur\(var\(--news-blur\)\);[\s\S]*filter:\s*var\(--news-distortion\);/,
    );
    expect(newsCss).toMatch(/\.news-glass-tint\s*\{[\s\S]*z-index:\s*1;[\s\S]*background:\s*var\(--news-tint\);/);
    expect(newsCss).toMatch(/\.news-glass-shine\s*\{[\s\S]*z-index:\s*2;/);
  });

  it("ports the complete demo composition before the live feed", () => {
    for (const className of [
      "news-intro",
      "news-command-bar",
      "news-tab-row",
      "news-glass-comparison",
      "news-lens",
      "news-mode-panel",
      "news-feed",
    ]) {
      expect(newsPage).toContain(className);
      expect(newsCss).toContain(`.${className}`);
    }

    expect(newsPage.indexOf("news-glass-comparison")).toBeLessThan(
      newsPage.indexOf("news-feed"),
    );
    expect(newsPage).toContain("Bốn lớp.");
    expect(newsPage).toContain("Nhìn xuyên qua khối kính");
  });

  it("keeps live news behavior and article visuals under the demo", () => {
    expect(newsPage).toMatch(/useNews\(topic\)/);
    expect(newsPage).toMatch(/onClick=\{refresh\}/);
    expect(newsPage).toMatch(/onClick=\{\(\) => setTopic\(tab\.id\)\}/);
    expect(newsPage).toMatch(/\(items \?\? \[\]\)\.map/);
    expect(newsPage).toContain("news-card-visual");
    expect(newsPage).toContain("news-card-title");
  });

  it("uses a moving pure-CSS aurora with transform-only keyframes", () => {
    expect(newsCss).toContain(".news-aurora-cyan");
    expect(newsCss).toContain(".news-aurora-violet");
    expect(newsCss).toContain(".news-aurora-coral");
    expect(newsCss).not.toMatch(/url\(["']?.*?\.(?:png|jpe?g|webp)/i);

    const keyframes = [...newsCss.matchAll(/@keyframes news-aurora-[\s\S]*?\n\}/g)]
      .map((match) => match[0])
      .join("\n");
    expect(keyframes).toMatch(/transform:/);
    expect(keyframes).not.toMatch(
      /(?:width|height|top|right|bottom|left|margin|padding|background-position)\s*:/,
    );
  });

  it("sends defined caustic edges across the glass controls", () => {
    expect(newsPage.match(/news-caustic news-caustic-/g)).toHaveLength(3);
    expect(newsCss).toMatch(
      /\.news-caustic\s*\{[\s\S]*mix-blend-mode:\s*screen;[\s\S]*will-change:\s*transform;/,
    );
    expect(newsCss).toMatch(/\.news-caustic-one\s*\{[\s\S]*animation:\s*news-caustic-sweep 14s/);
    expect(newsCss).toMatch(/\.news-caustic-two\s*\{[\s\S]*animation:\s*news-caustic-sweep 18s/);
    expect(newsCss).toMatch(/\.news-caustic-three\s*\{[\s\S]*animation:\s*news-caustic-return 16s/);

    const sweep = newsCss.match(/@keyframes news-caustic-sweep\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const returnSweep = newsCss.match(/@keyframes news-caustic-return\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    for (const motion of [sweep, returnSweep]) {
      expect(motion).toMatch(/transform:/);
      expect(motion).not.toMatch(
        /(?:width|height|top|right|bottom|left|margin|padding|background-position)\s*:/,
      );
    }
  });

  it("keeps refraction on decorative layers and active color on the tint", () => {
    expect(newsCss).toMatch(/\.news-glass-shine::after\s*\{[\s\S]*filter:\s*url\(#news-liquid-refraction\);/);
    expect(newsCss).toMatch(
      /\.news-tab \.news-glass-shine::after\s*\{[\s\S]*filter:\s*url\(#news-liquid-refraction-soft\);/,
    );
    expect(newsCss).toMatch(
      /\.news-tab-active \.news-glass-tint\s*\{[\s\S]*linear-gradient\(100deg,/,
    );
    expect(newsCss).not.toMatch(
      /\.news-(?:title|tab-label|refresh-label|back-icon|refresh-icon)\s*\{[^}]*\bfilter\s*:/,
    );
  });

  it("supports narrow screens and users who reduce motion", () => {
    expect(newsCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*\.news-tab-row\s*\{[\s\S]*overflow-x:\s*auto;/,
    );
    expect(newsCss).toMatch(
      /@media \(max-width: 700px\)[\s\S]*\.news-card\s*\{[\s\S]*grid-template-columns:\s*1fr;/,
    );
    expect(newsCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.news-aurora,[\s\S]*\.news-caustic\s*\{[\s\S]*animation:\s*none;/,
    );
  });

  it("does not animate every property implicitly", () => {
    expect(newsCss).not.toMatch(/transition:\s*all\b/);
  });
});
