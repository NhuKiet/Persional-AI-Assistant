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

describe("Pearl Aurora Glass CSS contract", () => {
  it("defines shared shell and secondary-glass tokens in base.css", () => {
    const css = readStyle("base.css");

    expect(css).toMatch(/--shell-surface\s*:/);
    expect(css).toMatch(/--shell-edge\s*:/);
    expect(css).toMatch(/--shell-blur\s*:/);
    expect(css).toMatch(/--secondary-glass-surface\s*:/);
    expect(css).toMatch(/--secondary-glass-edge\s*:/);
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

  it("applies the secondary material to Home actions and suggestions", () => {
    const chat = readStyle("chat.css");

    expect(chat).toMatch(/\.suggestion-card\s*\{[^}]*background:\s*var\(--secondary-glass-surface\);/s);
    expect(chat).toMatch(/\.dock-item\s*\{[^}]*background:\s*var\(--secondary-glass-surface\);/s);
    expect(chat).toMatch(/\.suggestion-card::before/);
    expect(chat).toMatch(/\.dock-item::before/);
  });
});
