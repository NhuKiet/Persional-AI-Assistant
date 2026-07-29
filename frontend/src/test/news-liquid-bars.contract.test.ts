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
const glassPanel = readFileSync(
  path.join(srcDirectory, "components/news/GlassControlPanel.tsx"),
  "utf8",
);

describe("Layered News interface contract", () => {
  it("uses live material defaults without static tuned overrides", () => {
    expect(newsCss).toMatch(/\.news-page\s*\{[\s\S]*--news-tint-alpha:\s*0\.12;/);
    expect(newsCss).toMatch(/--news-blur:\s*0\.75px;/);
    expect(newsCss).not.toMatch(/\.news-layered-tuned\s*\{[\s\S]*--news-(?:tint|blur):/);
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
    expect(newsCss).toMatch(
      /\.news-glass-tint\s*\{[\s\S]*z-index:\s*1;[\s\S]*background:\s*rgb\(255 255 255 \/ var\(--news-tint-alpha\)\);/,
    );
    expect(newsCss).toMatch(/\.news-glass-shine\s*\{[\s\S]*z-index:\s*2;/);
  });

  it("removes the grid and continuous white glass outline", () => {
    expect(newsCss).not.toContain(".news-liquid-ambient::before");
    const shine = newsCss.match(/\.news-glass-shine\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const active = newsCss.match(/\.news-tab-active\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(shine).not.toMatch(/\bborder\s*:/);
    expect(shine).not.toMatch(/inset -1px -1px 1px 1px var\(--news-rim-light\)/);
    expect(active).not.toMatch(/0 0 0 2px rgba\(255, 255, 255/);
  });

  it("removes continuous white perimeters from feed glass surfaces", () => {
    const feedGlassBlocks = [
      newsCss.match(/\.news-notice,\s*\n\.news-status\s*\{[\s\S]*?\n\}/)?.[0] ?? "",
      newsCss.match(/\.news-card\s*\{[\s\S]*?\n\}/)?.[0] ?? "",
      newsCss.match(/\.news-card:hover\s*\{[\s\S]*?\n\}/)?.[0] ?? "",
    ];

    for (const block of feedGlassBlocks) {
      expect(block).not.toMatch(
        /\bborder\s*:\s*1px solid (?:rgba\(255,\s*255,\s*255|rgb\(255\s+255\s+255)/,
      );
      expect(block).not.toMatch(
        /\binset[^,\n;]*?(?:rgba\(255,\s*255,\s*255|rgb\(255\s+255\s+255)/,
      );
      expect(block).toMatch(/var\(--news-depth-alpha\)/);
    }
  });

  it("styles a responsive seven-value glass instrument panel", () => {
    for (const selector of [
      ".news-light-control",
      ".news-light-pad",
      ".news-light-values",
      ".news-glass-ranges",
      ".news-range-row",
    ]) {
      expect(newsCss).toContain(selector);
    }
    expect(glassPanel).toMatch(/type="number"[\s\S]*aria-label="Góc sáng"/);
    expect(glassPanel).toMatch(/type="number"[\s\S]*aria-label="Cường độ sáng"/);
    expect(glassPanel.match(/type="range"/g)).toHaveLength(1);
    expect(glassPanel).toContain("RANGE_CONTROLS.map");
    expect(newsCss).toMatch(/@media \(max-width: 700px\)[\s\S]*\.news-mode-panel/);
  });

  it("maps live variables onto only decorative glass layers", () => {
    expect(newsCss).toMatch(/\.news-glass-effect\s*\{[\s\S]*blur\(var\(--news-blur\)\)/);
    expect(newsCss).toMatch(/\.news-glass-tint\s*\{[\s\S]*var\(--news-tint-alpha\)/);
    expect(newsCss).toMatch(
      /\.news-glass-shine::after\s*\{[\s\S]*var\(--news-light-angle\)[\s\S]*var\(--news-light-alpha\)[\s\S]*var\(--news-splay\)/,
    );
    expect(newsCss).toMatch(
      /\.news-glass-shine::before\s*\{[\s\S]*var\(--news-dispersion-left\)[\s\S]*var\(--news-dispersion-right\)/,
    );
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
