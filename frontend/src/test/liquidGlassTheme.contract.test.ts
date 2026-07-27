import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../styles",
);
const readStyle = (name: string) =>
  readFileSync(path.join(stylesDirectory, name), "utf8");
const tokenBlock = (css: string, selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"));

  expect(match, `Expected ${selector} token block`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("Pearl Aurora Glass CSS contract", () => {
  it("defines complete shared glass materials in both theme token blocks", () => {
    const css = readStyle("base.css");
    const dark = tokenBlock(css, ":root");
    const light = tokenBlock(css, ':root[data-theme="light"]');
    const requiredTokens = [
      "--shell-surface",
      "--shell-edge",
      "--secondary-glass-surface",
      "--secondary-glass-edge",
      "--secondary-glass-highlight",
      "--secondary-glass-shadow",
      "--composer-surface",
      "--composer-edge",
      "--composer-highlight",
      "--composer-shadow",
      "--composer-foreground",
      "--composer-muted",
      "--focus-ring",
    ];

    for (const token of requiredTokens) {
      expect(dark, `Dark theme must define ${token}`).toMatch(
        new RegExp(`${token}\\s*:`),
      );
      expect(light, `Light theme must define ${token}`).toMatch(
        new RegExp(`${token}\\s*:`),
      );
    }
  });

  it("does not cover the app-wide canvas with opaque outer shells", () => {
    const coding = readStyle("coding.css");
    const pdf = readStyle("pdf.css");
    const sidebar = readStyle("sidebar.css");

    expect(coding).toMatch(/\.app-layout\s*\{[^}]*background:\s*transparent;/s);
    expect(pdf).toMatch(/\.pdf-workspace-body\s*\{[^}]*background:\s*transparent;/s);
    expect(sidebar).toMatch(/\.sidebar\s*\{[^}]*background:\s*var\(--shell-surface\);/s);
  });

  it("keeps composer optics tokenized and consumed by chat.css", () => {
    const base = readStyle("base.css");
    const chat = readStyle("chat.css");

    expect(base).toMatch(/--composer-specular\s*:/);
    expect(base).toMatch(/--composer-blur\s*:/);
    expect(chat).toMatch(/background:\s*var\(--composer-specular\);/);
    expect(chat).toMatch(/backdrop-filter:\s*var\(--composer-blur\);/);
  });

  it("uses theme-aware composer text and focus-ring tokens", () => {
    const chat = readStyle("chat.css");

    expect(chat).toMatch(
      /\.input-textarea\s*\{[^}]*color:\s*var\(--composer-foreground\);/s,
    );
    expect(chat).toMatch(
      /\.input-textarea::placeholder\s*\{[^}]*color:\s*var\(--composer-muted\);/s,
    );
    expect(chat).toMatch(
      /\.input-bar \.mp-trigger\s*\{[^}]*color:\s*var\(--composer-muted\);/s,
    );
    expect(chat).toMatch(
      /\.input-attach\s*\{[^}]*color:\s*var\(--composer-muted\);/s,
    );
    expect(chat).toMatch(
      /\.mic-btn\s*\{[^}]*color:\s*var\(--composer-muted\);/s,
    );
    expect(chat).toMatch(
      /\.input-bar \.mp-option\s*\{[^}]*color:\s*var\(--composer-muted\);/s,
    );
    expect(chat).toMatch(
      /\.suggestion-card:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);/s,
    );
    expect(chat).toMatch(
      /\.dock-item:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);/s,
    );
  });

  it("applies the secondary material to Home actions and suggestions", () => {
    const chat = readStyle("chat.css");

    expect(chat).toMatch(/\.suggestion-card\s*\{[^}]*background:\s*var\(--secondary-glass-surface\);/s);
    expect(chat).toMatch(/\.dock-item\s*\{[^}]*background:\s*var\(--secondary-glass-surface\);/s);
    expect(chat).toMatch(/\.suggestion-card::before/);
    expect(chat).toMatch(/\.dock-item::before/);
  });
});
