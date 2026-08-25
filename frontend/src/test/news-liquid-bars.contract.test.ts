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

  it("keeps the News CSS fallback within the bounded glint footprint", () => {
    const newsPageDefaults =
      newsCss.match(/\.news-page\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(newsPageDefaults).toMatch(/--news-splay:\s*14\.12%;/);
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

  it("anchors a small asymmetric glint at the upper-left corner", () => {
    const dispersion =
      newsCss.match(/\.news-glass-shine::before\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    const highlight =
      newsCss.match(/\.news-glass-shine::after\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(dispersion).toMatch(/top:\s*1px;/);
    expect(dispersion).toMatch(/left:\s*clamp\(4px,\s*1\.4%,\s*16px\);/);
    expect(dispersion).toMatch(/transform:\s*rotate\(-10deg\);/);
    expect(dispersion).toMatch(/transform-origin:\s*left center;/);

    expect(highlight).toMatch(/top:\s*-8%;/);
    expect(highlight).toMatch(/left:\s*-1%;/);
    expect(highlight).toMatch(/border-radius:\s*0 0 72% 0;/);
    expect(highlight).toMatch(
      /radial-gradient\(ellipse 120% 105% at 0 0,/,
    );
    expect(highlight).toMatch(/transform:\s*rotate\(-4deg\);/);
    expect(highlight).toMatch(/transform-origin:\s*top left;/);

    for (const layer of [dispersion, highlight]) {
      expect(layer).toMatch(/width:\s*var\(--news-splay\);/);
      expect(layer).not.toMatch(/left:\s*50%/);
      expect(layer).not.toMatch(/translateX\(-50%\)/);
      expect(layer).not.toMatch(/width:\s*100%/);
      expect(layer).not.toMatch(/\binset\s*:/);
      expect(layer).not.toMatch(/\bright\s*:/);
      expect(layer).not.toMatch(/\bbottom\s*:/);
      expect(layer).not.toMatch(/\bborder(?!-radius)(?:-[\w-]+)?\s*:/);
    }
  });

  it("keeps only the shipping surfaces: command bar, topics, feed", () => {
    for (const className of [
      "news-command-shell",
      "news-command-bar",
      "news-tab-row",
      "news-settings-btn",
      "news-mode-panel",
      "news-feed",
    ]) {
      expect(newsPage).toContain(className);
      expect(newsCss).toContain(`.${className}`);
    }

    // Khung dựng demo đã gỡ khỏi trang thật.
    for (const removed of [
      "news-intro",
      "news-scene-word",
      "news-glass-comparison",
      "news-lens",
      "Bốn lớp.",
      "Nhìn xuyên qua khối kính",
    ]) {
      expect(newsPage).not.toContain(removed);
      expect(newsCss).not.toContain(removed);
    }

    expect(newsPage.indexOf("news-command-shell")).toBeLessThan(
      newsPage.indexOf("news-feed"),
    );
  });

  it("anchors the tuning panel as a popover on the command shell", () => {
    // Thanh lệnh có overflow:hidden nên panel phải là con của shell.
    expect(newsPage).toMatch(
      /news-command-shell[\s\S]*<\/header>[\s\S]*glassPanelOpen &&[\s\S]*news-mode-panel/,
    );
    expect(newsPage).toMatch(/aria-expanded=\{glassPanelOpen\}/);
    expect(newsPage).toMatch(/aria-controls="news-glass-panel"/);
    expect(newsCss).toMatch(/\.news-command-shell\s*\{[\s\S]*position:\s*relative;/);
    expect(newsCss).toMatch(
      /\.news-mode-panel\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*0;/,
    );
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

  it("owns the botanical palette and keeps the ambient field subordinate", () => {
    const newsPageDefaults =
      newsCss.match(/\.news-page\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(newsPageDefaults).toMatch(/--news-leaf-copper:\s*#b77a59;/);
    expect(newsPageDefaults).toMatch(/--news-leaf-gold:\s*#c0a36b;/);
    expect(newsPageDefaults).toMatch(/--news-leaf-sage:\s*#7f8d73;/);
    expect(newsPageDefaults).toMatch(/--news-leaf-rose:\s*#aa7772;/);

    const approvedOpacities = [
      ["news-liquid-ambient::after", "0\\.55"],
      ["news-aurora", "0\\.62"],
      ["news-aurora-violet", "0\\.52"],
      ["news-aurora-coral", "0\\.48"],
      ["news-aurora-gold", "0\\.40"],
      ["news-aurora-prism", "0\\.60"],
    ] as const;

    for (const [selector, opacity] of approvedOpacities) {
      const block =
        newsCss.match(
          new RegExp(`\\.${selector}\\s*\\{[\\s\\S]*?\\n\\}`),
        )?.[0] ?? "";
      expect(block).toMatch(new RegExp(`opacity:\\s*${opacity};`));
    }

    const canvas =
      newsCss.match(/\.news-leaves-canvas\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(canvas).toMatch(/z-index:\s*-1;/);
    expect(canvas).toMatch(/pointer-events:\s*none;/);
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
