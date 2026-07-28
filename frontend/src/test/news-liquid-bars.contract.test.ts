import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../styles",
);
const newsCss = readFileSync(path.join(stylesDirectory, "news.css"), "utf8");

type CssBlock = { prelude: string; body: string };

const normalisePrelude = (prelude: string) =>
  prelude.replace(/\/\*[\s\S]*?\*\//g, "").trim();

const cssBlocks = (css: string): CssBlock[] => {
  const blocks: CssBlock[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;

  for (let index = 0; index < css.length; index += 1) {
    if (css[index] === "{") {
      if (depth === 0) bodyStart = index + 1;
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        blocks.push({
          prelude: normalisePrelude(css.slice(preludeStart, bodyStart - 1)),
          body: css.slice(bodyStart, index),
        });
        preludeStart = index + 1;
      }
    }
  }

  return blocks;
};

const splitSelectors = (prelude: string) =>
  prelude.split(",").map((selector) => selector.trim());

const blockByPrelude = (css: string, prelude: string) => {
  const matches = cssBlocks(css).filter((block) => block.prelude === prelude);

  expect(matches, `Expected exactly one ${prelude} block`).toHaveLength(1);
  return matches[0]?.body ?? "";
};

const selectorBlock = (css: string, selector: string) =>
  blockByPrelude(css, selector);

const groupedSelectorBlock = (css: string, selectors: string[]) => {
  const matches = cssBlocks(css).filter(
    (block) => JSON.stringify(splitSelectors(block.prelude)) === JSON.stringify(selectors),
  );

  expect(
    matches,
    `Expected exactly one grouped selector block: ${selectors.join(", ")}`,
  ).toHaveLength(1);
  return matches[0]?.body ?? "";
};

const atRuleBlock = (css: string, atRule: string) => blockByPrelude(css, atRule);

describe("News liquid bars CSS contract", () => {
  it("defines the complete local liquid material", () => {
    const page = selectorBlock(newsCss, ".news-page");

    for (const token of [
      "--news-glass-edge",
      "--news-glass-rim-outer",
      "--news-glass-rim-inner",
      "--news-glass-specular",
      "--news-glass-underside",
      "--news-glass-ambient",
      "--news-glass-ambient-lift",
      "--news-refraction",
      "--news-refraction-soft",
    ]) {
      expect(page, `Expected ${token} in .news-page`).toMatch(
        new RegExp(`${token}\\s*:`),
      );
    }
  });

  it("preserves desktop command and topic geometry", () => {
    const command = selectorBlock(newsCss, ".news-command-bar");
    const back = selectorBlock(newsCss, ".news-back");
    const refresh = selectorBlock(newsCss, ".news-refresh-btn");
    const topic = selectorBlock(newsCss, ".news-tab");

    expect(command).toMatch(/height:\s*76px;/);
    expect(command).toMatch(/border-radius:\s*28px;/);
    expect(back).toMatch(/width:\s*58px;/);
    expect(back).toMatch(/height:\s*52px;/);
    expect(refresh).toMatch(/width:\s*146px;/);
    expect(refresh).toMatch(/height:\s*52px;/);
    expect(topic).toMatch(/flex:\s*0 0 auto;/);
    expect(topic).toMatch(/border-radius:\s*999px;/);
  });

  it("keeps every refraction filter on decorative highlight layers only", () => {
    const commandHighlight = selectorBlock(newsCss, ".news-command-bar::after");
    const controlHighlights = groupedSelectorBlock(newsCss, [
      ".news-back::after",
      ".news-refresh-btn::after",
      ".news-tab::after",
    ]);
    const labelAndIconLayer = groupedSelectorBlock(newsCss, [
      ".news-back-icon",
      ".news-refresh-icon",
      ".news-refresh-label",
      ".news-tab-label",
    ]);
    const filteredBlocks = cssBlocks(newsCss).filter((block) =>
      /\bfilter\s*:\s*var\(--news-refraction(?:-soft)?\)\s*;/.test(block.body),
    );

    expect(commandHighlight).toMatch(/filter:\s*var\(--news-refraction\);/);
    expect(controlHighlights).toMatch(/filter:\s*var\(--news-refraction-soft\);/);
    expect(labelAndIconLayer).not.toMatch(/\bfilter\s*:/);
    expect(filteredBlocks).toHaveLength(2);
    expect(filteredBlocks.map((block) => splitSelectors(block.prelude))).toEqual([
      [".news-command-bar::after"],
      [
        ".news-back::after",
        ".news-refresh-btn::after",
        ".news-tab::after",
      ],
    ]);
  });

  it("keeps the active topic's white text and exact gradient", () => {
    const activeTopic = selectorBlock(newsCss, ".news-tab-active");

    expect(activeTopic).toMatch(/color:\s*#fff;/);
    expect(activeTopic).toMatch(
      /linear-gradient\(100deg, #17c9e2 0%, #1d9ae0 46%, #3f74ea 100%\)/,
    );
  });

  it("provides opaque material when backdrop filters are unavailable", () => {
    const fallback = atRuleBlock(newsCss, "@supports not (backdrop-filter: blur(2px))");
    const controls = groupedSelectorBlock(fallback, [
      ".news-command-bar",
      ".news-back",
      ".news-refresh-btn",
      ".news-tab",
    ]);

    expect(controls).toMatch(/background-color:\s*rgba\(255, 255, 255, 0\.94\);/);
    const activeTopic = selectorBlock(fallback, ".news-tab-active");

    expect(activeTopic).toMatch(
      /background-color:\s*transparent;/,
    );
    expect(activeTopic).not.toMatch(/\bbackground(?:-image)?\s*:/);
  });

  it("turns off liquid-bar motion and refraction when motion is reduced", () => {
    const reducedMotion = atRuleBlock(
      newsCss,
      "@media (prefers-reduced-motion: reduce)",
    );
    const page = selectorBlock(reducedMotion, ".news-page");
    const controls = groupedSelectorBlock(reducedMotion, [
      ".news-back",
      ".news-refresh-btn",
      ".news-tab",
    ]);
    const movement = groupedSelectorBlock(reducedMotion, [
      ".news-back:hover",
      ".news-refresh-btn:hover:not(:disabled)",
      ".news-tab:hover:not(.news-tab-active)",
      ".news-back:active",
      ".news-refresh-btn:active:not(:disabled)",
      ".news-tab:active",
      ".news-card:hover",
    ]);
    const refreshIcon = selectorBlock(
      reducedMotion,
      '.news-refresh-btn[aria-busy="true"] .news-refresh-icon',
    );

    expect(page).toMatch(/--news-refraction:\s*none;/);
    expect(page).toMatch(/--news-refraction-soft:\s*none;/);
    expect(controls).toMatch(/transition:\s*none;/);
    expect(movement).toMatch(/transform:\s*none;/);
    expect(refreshIcon).toMatch(/animation:\s*none;/);
  });

  it("keeps mobile topics in a padded scrolling row with 46px targets", () => {
    const mobile = atRuleBlock(newsCss, "@media (max-width: 700px)");
    const topics = selectorBlock(mobile, ".news-tab-row");
    const back = selectorBlock(mobile, ".news-back");
    const refresh = selectorBlock(mobile, ".news-refresh-btn");

    expect(topics).toMatch(/flex-wrap:\s*nowrap;/);
    expect(topics).toMatch(/overflow-x:\s*auto;/);
    expect(topics).toMatch(/padding:\s*9px 16px 12px;/);
    expect(back).toMatch(/width:\s*46px;/);
    expect(back).toMatch(/height:\s*46px;/);
    expect(refresh).toMatch(/min-width:\s*46px;/);
    expect(refresh).toMatch(/min-height:\s*46px;/);
  });

  it("closes topic gaps and padding at the tablet breakpoint", () => {
    const tablet = atRuleBlock(newsCss, "@media (max-width: 1099px)");
    const topics = selectorBlock(tablet, ".news-tab-row");
    const topic = selectorBlock(tablet, ".news-tab");

    expect(topics).toMatch(/gap:\s*10px;/);
    expect(topic).toMatch(/padding-inline:\s*clamp\(20px, 3vw, 40px\);/);
  });

  it("reuses the shared spin keyframe for Refresh", () => {
    const refreshIcon = selectorBlock(
      newsCss,
      '.news-refresh-btn[aria-busy="true"] .news-refresh-icon',
    );

    expect(newsCss).not.toMatch(/@keyframes\s+news-refresh-spin\b/);
    expect(refreshIcon).toMatch(/animation:\s*spin\s+900ms linear infinite;/);
  });
});
