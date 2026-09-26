import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Syntax colors must stay readable (WCAG AA, 4.5:1) on both surfaces code
 *  sits on, in both themes:
 *  - the Coding page, where code blocks sit on --bg;
 *  - chat answers, where `.md-code` is a well of 70% --bg over the bubble
 *    (--bg2 over --bg) — see chat.css.
 *  The old dark comment color was 2.2:1 and practically invisible. */

const css = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../styles/base.css"),
  "utf8",
);

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`no ${selector} block`);
  return match[1];
}

function token(body: string, name: string): string {
  const m = body.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`no --${name}`);
  return m[1].trim();
}

type RGBA = [number, number, number, number];

function parse(color: string): RGBA {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgba = color.match(/^rgba\(([^)]+)\)$/);
  if (rgba) return rgba[1].split(",").map(Number) as RGBA;
  throw new Error(`unparsed color ${color}`);
}

function over([r, g, b, a]: RGBA, [R, G, B]: RGBA): RGBA {
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
}

function luminance([r, g, b]: RGBA): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const themes = {
  dark: block(":root"),
  light: block(':root[data-theme="light"]'),
};

describe.each(Object.entries(themes))("syntax colors, %s theme", (_theme, body) => {
  const bg = parse(token(body, "bg"));
  const bubble = over(parse(token(body, "bg2")), bg);
  const well = over([bg[0], bg[1], bg[2], 0.7], bubble);

  it.each(["sh-keyword", "sh-string", "sh-comment", "sh-number"])("%s is ≥ 4.5:1 on the page and in the chat code well", name => {
    const color = parse(token(body, name));
    expect(contrast(color, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color, well)).toBeGreaterThanOrEqual(4.5);
  });
});
