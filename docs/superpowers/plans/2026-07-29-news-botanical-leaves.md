# News Botanical Leaves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse News falling-leaf canvas with a sparse, translucent, depth-aware botanical background while preserving all News content and liquid-glass behavior.

**Architecture:** Put deterministic particle generation and motion in a DOM-free TypeScript model. Keep React responsible only for canvas lifecycle and cached sprite drawing, while the existing News stylesheet owns palette and ambient strength. Pure model tests cover physics and density; component tests cover browser lifecycles; the dirty News CSS receives narrowly audited contract coverage.

**Tech Stack:** React 18, TypeScript, Canvas 2D, hand-written CSS, Vitest, Testing Library.

## Global Constraints

- Use direction A, “Kính thực vật”: sparse translucent asymmetric leaves; glass remains the highest-contrast material.
- Total density is exactly 8 below 700 px, 11 from 700–1099 px, and 14 at 1100 px or above.
- Far leaves: 35% target share, 4–7 px, opacity 0.08–0.16, fall speed 8–14 px/s, baked blur 1.2 px.
- Mid leaves: exact population remainder, 7–11 px, opacity 0.14–0.26, fall speed 12–20 px/s, baked blur 0.35 px.
- Near leaves: at least one using a 15% floored target share, 10–15 px, opacity 0.20–0.34, fall speed 18–27 px/s, no blur.
- Use News palette variables for copper `#b77a59`, muted gold `#c0a36b`, sage `#7f8d73`, and dusty rose `#aa7772`; do not duplicate these hex values in TypeScript.
- Use no black outline, hard perimeter, or drop shadow on leaves.
- Base wind is 3–7 px/s, changing drift is 2–6 px/s, rotation is `-0.18..0.18` rad/s, flutter is `0.78..1`, and delta time is capped at `0.05 s`.
- Fade over the first and last 12% of the route; respawn above the viewport after exit, never wrap visibly across an edge.
- Cap DPR at 2 and cache exactly 12 sprites: four palette colors across three depth bands.
- Pause animation while the document is hidden.
- Under reduced motion, draw exactly five static leaves and schedule no animation loop.
- Ambient opacity values are exactly: shared aurora `0.62`, violet `0.52`, coral `0.48`, gold `0.40`, prism `0.60`, white overlay `0.55`.
- Keep caustic sweeps, glass variables and pseudo-elements, News loading, controls, feed, responsive layout, and article data behavior unchanged.
- Add no dependency, stylesheet, or animation library.
- `frontend/src/styles/news.css` and `frontend/src/test/news-liquid-bars.contract.test.ts` contain pre-existing uncommitted user work. Never stage or commit those files wholesale.

---

### Task 1: Deterministic Leaf Model

**Files:**
- Create: `frontend/src/components/news/fallingLeavesModel.ts`
- Create: `frontend/src/components/news/fallingLeavesModel.test.ts`

**Interfaces:**
- Produces:
  - `LeafDepth`, `LeafBounds`, `LeafParticle`, and `RandomSource`.
  - `DEPTH_CONFIG`.
  - `createSeededRandom(seed: number): RandomSource`.
  - `leafCountForWidth(width: number): 8 | 11 | 14`.
  - `depthCounts(total: number): Record<LeafDepth, number>`.
  - `createLeafPopulation(bounds, random, total, initial): LeafParticle[]`.
  - `stepLeaf(particle, bounds, dt, elapsed, random): void`.
  - `routeOpacity(particle, height): number`.
- Consumes no DOM or canvas API.

- [ ] **Step 1: Write the failing model tests**

Create `fallingLeavesModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEPTH_CONFIG,
  createLeafPopulation,
  createSeededRandom,
  depthCounts,
  leafCountForWidth,
  routeOpacity,
  stepLeaf,
  type LeafParticle,
} from "./fallingLeavesModel";

describe("fallingLeavesModel", () => {
  it("uses the approved responsive density buckets", () => {
    expect(leafCountForWidth(390)).toBe(8);
    expect(leafCountForWidth(699)).toBe(8);
    expect(leafCountForWidth(700)).toBe(11);
    expect(leafCountForWidth(1099)).toBe(11);
    expect(leafCountForWidth(1100)).toBe(14);
    expect(leafCountForWidth(1440)).toBe(14);
  });

  it("keeps far and near sparse while assigning the remainder to mid", () => {
    expect(depthCounts(8)).toEqual({ far: 2, mid: 5, near: 1 });
    expect(depthCounts(11)).toEqual({ far: 3, mid: 7, near: 1 });
    expect(depthCounts(14)).toEqual({ far: 4, mid: 8, near: 2 });
  });

  it("generates every depth band inside its approved bounds", () => {
    const leaves = createLeafPopulation(
      { width: 1200, height: 700 },
      createSeededRandom(0x1eaf),
      14,
      true,
    );

    expect(leaves).toHaveLength(14);
    for (const leaf of leaves) {
      const config = DEPTH_CONFIG[leaf.depth];
      expect(leaf.size).toBeGreaterThanOrEqual(config.size[0]);
      expect(leaf.size).toBeLessThanOrEqual(config.size[1]);
      expect(leaf.baseOpacity).toBeGreaterThanOrEqual(config.opacity[0]);
      expect(leaf.baseOpacity).toBeLessThanOrEqual(config.opacity[1]);
      expect(leaf.fallSpeed).toBeGreaterThanOrEqual(config.fallSpeed[0]);
      expect(leaf.fallSpeed).toBeLessThanOrEqual(config.fallSpeed[1]);
      expect(leaf.rotationSpeed).toBeGreaterThanOrEqual(-0.18);
      expect(leaf.rotationSpeed).toBeLessThanOrEqual(0.18);
      expect(leaf.colorIndex).toBeGreaterThanOrEqual(0);
      expect(leaf.colorIndex).toBeLessThan(4);
    }
  });

  it("updates deterministically and caps a long frame to 0.05 seconds", () => {
    const bounds = { width: 900, height: 600 };
    const randomA = createSeededRandom(77);
    const randomB = createSeededRandom(77);
    const leafA = createLeafPopulation(bounds, randomA, 8, true)[0];
    const leafB = createLeafPopulation(bounds, randomB, 8, true)[0];

    stepLeaf(leafA, bounds, 2, 1.25, randomA);
    stepLeaf(leafB, bounds, 0.05, 1.25, randomB);

    expect(leafA).toEqual(leafB);
    expect(leafA.flutter).toBeGreaterThanOrEqual(0.78);
    expect(leafA.flutter).toBeLessThanOrEqual(1);
  });

  it("fades at both route edges and respawns above instead of wrapping", () => {
    const bounds = { width: 800, height: 500 };
    const random = createSeededRandom(9);
    const leaf = createLeafPopulation(bounds, random, 8, true)[0] as LeafParticle;

    leaf.y = -leaf.size * 2;
    expect(routeOpacity(leaf, bounds.height)).toBe(0);
    leaf.y = bounds.height / 2;
    expect(routeOpacity(leaf, bounds.height)).toBe(1);
    leaf.y = bounds.height + leaf.size * 2;
    expect(routeOpacity(leaf, bounds.height)).toBe(0);

    leaf.y = bounds.height + leaf.size * 3;
    stepLeaf(leaf, bounds, 0.016, 2, random);
    expect(leaf.y).toBeLessThan(0);
    expect(leaf.x).toBeGreaterThanOrEqual(-32);
    expect(leaf.x).toBeLessThanOrEqual(bounds.width + 32);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run from `frontend`:

```powershell
npm.cmd test -- --run src/components/news/fallingLeavesModel.test.ts
```

Expected: FAIL because `fallingLeavesModel.ts` does not exist.

- [ ] **Step 3: Implement the DOM-free model**

Create `fallingLeavesModel.ts`:

```ts
export type LeafDepth = "far" | "mid" | "near";
export type RandomSource = () => number;

export interface LeafBounds {
  width: number;
  height: number;
}

export interface LeafParticle {
  id: number;
  depth: LeafDepth;
  colorIndex: number;
  x: number;
  y: number;
  size: number;
  baseOpacity: number;
  fallSpeed: number;
  wind: number;
  swayA: number;
  swayB: number;
  frequencyA: number;
  frequencyB: number;
  phaseA: number;
  phaseB: number;
  rotation: number;
  rotationSpeed: number;
  flutterPhase: number;
  flutterSpeed: number;
  flutter: number;
}

interface DepthConfig {
  size: readonly [number, number];
  opacity: readonly [number, number];
  fallSpeed: readonly [number, number];
  blur: number;
}

export const DEPTH_CONFIG: Record<LeafDepth, DepthConfig> = {
  far: { size: [4, 7], opacity: [0.08, 0.16], fallSpeed: [8, 14], blur: 1.2 },
  mid: { size: [7, 11], opacity: [0.14, 0.26], fallSpeed: [12, 20], blur: 0.35 },
  near: { size: [10, 15], opacity: [0.2, 0.34], fallSpeed: [18, 27], blur: 0 },
};

const OVERSCAN = 32;
const FADE_FRACTION = 0.12;
const DEPTH_ORDER: readonly LeafDepth[] = ["far", "mid", "near"];

function between(random: RandomSource, min: number, max: number): number {
  return min + random() * (max - min);
}

export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function leafCountForWidth(width: number): 8 | 11 | 14 {
  if (width < 700) return 8;
  if (width < 1100) return 11;
  return 14;
}

export function depthCounts(total: number): Record<LeafDepth, number> {
  const safeTotal = Math.max(1, Math.floor(total));
  const far = Math.floor(safeTotal * 0.35);
  const near = Math.max(1, Math.floor(safeTotal * 0.15));
  return { far, mid: safeTotal - far - near, near };
}

function resetLeaf(
  leaf: LeafParticle,
  bounds: LeafBounds,
  random: RandomSource,
  initial: boolean,
): void {
  const config = DEPTH_CONFIG[leaf.depth];
  leaf.colorIndex = Math.floor(random() * 4);
  leaf.x = between(random, -OVERSCAN, bounds.width + OVERSCAN);
  leaf.y = initial
    ? between(random, -bounds.height * 0.08, bounds.height)
    : between(random, -Math.max(48, bounds.height * 0.14), -leaf.size * 2);
  leaf.size = between(random, config.size[0], config.size[1]);
  leaf.baseOpacity = between(random, config.opacity[0], config.opacity[1]);
  leaf.fallSpeed = between(random, config.fallSpeed[0], config.fallSpeed[1]);
  leaf.wind = between(random, 3, 7);
  leaf.swayA = between(random, 2, 4);
  leaf.swayB = between(random, 1, 2);
  leaf.frequencyA = between(random, 0.22, 0.48);
  leaf.frequencyB = between(random, 0.5, 0.86);
  leaf.phaseA = between(random, 0, Math.PI * 2);
  leaf.phaseB = between(random, 0, Math.PI * 2);
  leaf.rotation = between(random, 0, Math.PI * 2);
  leaf.rotationSpeed = between(random, -0.18, 0.18);
  leaf.flutterPhase = between(random, 0, Math.PI * 2);
  leaf.flutterSpeed = between(random, 0.7, 1.25);
  leaf.flutter = between(random, 0.78, 1);
}

function createLeaf(
  id: number,
  depth: LeafDepth,
  bounds: LeafBounds,
  random: RandomSource,
  initial: boolean,
): LeafParticle {
  const leaf: LeafParticle = {
    id,
    depth,
    colorIndex: 0,
    x: 0,
    y: 0,
    size: DEPTH_CONFIG[depth].size[0],
    baseOpacity: DEPTH_CONFIG[depth].opacity[0],
    fallSpeed: DEPTH_CONFIG[depth].fallSpeed[0],
    wind: 3,
    swayA: 2,
    swayB: 1,
    frequencyA: 0.22,
    frequencyB: 0.5,
    phaseA: 0,
    phaseB: 0,
    rotation: 0,
    rotationSpeed: 0,
    flutterPhase: 0,
    flutterSpeed: 0.7,
    flutter: 1,
  };
  resetLeaf(leaf, bounds, random, initial);
  return leaf;
}

export function createLeafPopulation(
  bounds: LeafBounds,
  random: RandomSource,
  total = leafCountForWidth(bounds.width),
  initial = true,
): LeafParticle[] {
  const counts = depthCounts(total);
  const leaves: LeafParticle[] = [];
  for (const depth of DEPTH_ORDER) {
    for (let index = 0; index < counts[depth]; index += 1) {
      leaves.push(createLeaf(leaves.length, depth, bounds, random, initial));
    }
  }
  return leaves;
}

export function routeOpacity(leaf: LeafParticle, height: number): number {
  const start = -leaf.size * 2;
  const end = height + leaf.size * 2;
  const progress = Math.min(1, Math.max(0, (leaf.y - start) / (end - start)));
  return Math.min(
    1,
    progress / FADE_FRACTION,
    (1 - progress) / FADE_FRACTION,
  );
}

export function stepLeaf(
  leaf: LeafParticle,
  bounds: LeafBounds,
  dt: number,
  elapsed: number,
  random: RandomSource,
): void {
  const safeDt = Math.min(Math.max(dt, 0), 0.05);
  const drift =
    Math.sin(elapsed * leaf.frequencyA + leaf.phaseA) * leaf.swayA +
    Math.sin(elapsed * leaf.frequencyB + leaf.phaseB) * leaf.swayB;
  leaf.x += (leaf.wind + drift) * safeDt;
  leaf.y += leaf.fallSpeed * safeDt;
  leaf.rotation += leaf.rotationSpeed * safeDt;
  leaf.flutter =
    0.89 + Math.sin(elapsed * leaf.flutterSpeed + leaf.flutterPhase) * 0.11;

  const outsideBottom = leaf.y - leaf.size > bounds.height + OVERSCAN;
  const outsideSide =
    leaf.x - leaf.size > bounds.width + OVERSCAN ||
    leaf.x + leaf.size < -OVERSCAN;
  if (outsideBottom || outsideSide) resetLeaf(leaf, bounds, random, false);
}
```

- [ ] **Step 4: Run the model tests and verify GREEN**

Run:

```powershell
npm.cmd test -- --run src/components/news/fallingLeavesModel.test.ts
```

Expected: 1 file, 5 tests PASS.

- [ ] **Step 5: Commit the model**

```powershell
git add frontend/src/components/news/fallingLeavesModel.ts frontend/src/components/news/fallingLeavesModel.test.ts
git commit -m "feat(news): add botanical leaf motion model"
```

---

### Task 2: Cached Canvas Renderer and Lifecycle

**Files:**
- Replace: `frontend/src/components/news/FallingLeaves.tsx`
- Create: `frontend/src/components/news/FallingLeaves.test.tsx`

**Interfaces:**
- Consumes all Task 1 exports.
- Reads inherited CSS variables `--news-leaf-copper`, `--news-leaf-gold`, `--news-leaf-sage`, and `--news-leaf-rose`.
- Produces `<FallingLeaves />` with no props and the existing
  `news-leaves-canvas` class.

- [ ] **Step 1: Record the pre-existing component**

Before editing:

```powershell
Copy-Item frontend/src/components/news/FallingLeaves.tsx .superpowers/sdd/botanical-FallingLeaves.pre.tsx
git status --short
```

The file is currently untracked user work. The replacement is authorized, but
no other dirty News file may change in this task.

- [ ] **Step 2: Write the failing lifecycle tests**

Create `FallingLeaves.test.tsx`:

```tsx
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FallingLeaves } from "./FallingLeaves";

function makeContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
    filter: "none",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe("FallingLeaves", () => {
  let context: CanvasRenderingContext2D;
  let mediaMatches = false;
  let mediaListener: (() => void) | undefined;
  let resizeCallback: (() => void) | undefined;
  const disconnect = vi.fn();

  beforeEach(() => {
    context = makeContext();
    mediaMatches = false;
    mediaListener = undefined;
    resizeCallback = undefined;
    disconnect.mockClear();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1200,
      height: 600,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        ({
          "--news-leaf-copper": "#b77a59",
          "--news-leaf-gold": "#c0a36b",
          "--news-leaf-sage": "#7f8d73",
          "--news-leaf-rose": "#aa7772",
        })[name] ?? "",
    } as CSSStyleDeclaration);
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return mediaMatches; },
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        mediaListener = listener;
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    })));
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resizeCallback = callback; }
      observe() {}
      disconnect() { disconnect(); }
    });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 41));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 3,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caps DPR, schedules one loop, and cleans every lifecycle", () => {
    const { container, unmount } = render(<FallingLeaves />);
    const canvas = container.querySelector("canvas");

    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas?.width).toBe(2400);
    expect(canvas?.height).toBe(1200);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    act(() => resizeCallback?.());
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("pauses while hidden and resumes with one fresh frame", () => {
    render(<FallingLeaves />);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it("draws five static leaves and no loop under reduced motion", () => {
    mediaMatches = true;
    render(<FallingLeaves />);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledTimes(5);
  });

  it("switches cleanly when the motion preference changes", () => {
    render(<FallingLeaves />);
    mediaMatches = true;
    act(() => mediaListener?.());
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(context.drawImage).toHaveBeenCalled();
  });

  it("does nothing when the canvas context is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(() => render(<FallingLeaves />)).not.toThrow();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the component tests and verify RED**

Run:

```powershell
npm.cmd test -- --run src/components/news/FallingLeaves.test.tsx
```

Expected: FAIL because the existing component accepts a density prop, draws
uncached flat leaves, does not implement the approved lifecycle, and schedules
a loop under reduced motion.

- [ ] **Step 4: Replace the renderer**

Replace `FallingLeaves.tsx` with:

```tsx
import { useEffect, useRef } from "react";
import {
  DEPTH_CONFIG,
  createLeafPopulation,
  createSeededRandom,
  leafCountForWidth,
  routeOpacity,
  stepLeaf,
  type LeafBounds,
  type LeafDepth,
  type LeafParticle,
} from "./fallingLeavesModel";

const PALETTE_VARIABLES = [
  "--news-leaf-copper",
  "--news-leaf-gold",
  "--news-leaf-sage",
  "--news-leaf-rose",
] as const;
const STATIC_LEAF_COUNT = 5;
const SPRITE_SIZE = 64;
const SCENE_SEED = 0x1eaf;

type SpriteCache = Map<string, HTMLCanvasElement>;

function spriteKey(depth: LeafDepth, colorIndex: number): string {
  return `${depth}:${colorIndex}`;
}

function createSprite(depth: LeafDepth, color: string): HTMLCanvasElement | null {
  const sprite = document.createElement("canvas");
  sprite.width = SPRITE_SIZE;
  sprite.height = SPRITE_SIZE;
  const context = sprite.getContext("2d");
  if (!context) return null;

  const center = SPRITE_SIZE / 2;
  const radius = SPRITE_SIZE * 0.32;
  const gradient = context.createLinearGradient(
    center - radius,
    center - radius,
    center + radius,
    center + radius,
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.58)");
  gradient.addColorStop(0.3, color);
  gradient.addColorStop(1, "rgba(26, 36, 45, 0.2)");

  context.save();
  context.translate(center, center);
  context.rotate(-0.16);
  context.filter = DEPTH_CONFIG[depth].blur
    ? `blur(${DEPTH_CONFIG[depth].blur}px)`
    : "none";
  context.beginPath();
  context.moveTo(radius * 0.08, -radius);
  context.bezierCurveTo(
    radius * 0.7,
    -radius * 0.52,
    radius * 0.58,
    radius * 0.56,
    -radius * 0.12,
    radius,
  );
  context.bezierCurveTo(
    -radius * 0.78,
    radius * 0.42,
    -radius * 0.48,
    -radius * 0.72,
    radius * 0.08,
    -radius,
  );
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.globalAlpha = 0.16;
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(radius * 0.04, -radius * 0.72);
  context.quadraticCurveTo(-radius * 0.08, 0, -radius * 0.12, radius * 0.78);
  context.stroke();
  context.restore();
  return sprite;
}

function createSpriteCache(canvas: HTMLCanvasElement): SpriteCache | null {
  const computed = window.getComputedStyle(canvas);
  const palette = PALETTE_VARIABLES.map((name) =>
    computed.getPropertyValue(name).trim()
  );
  if (palette.some((color) => !color)) return null;

  const cache: SpriteCache = new Map();
  for (const depth of Object.keys(DEPTH_CONFIG) as LeafDepth[]) {
    palette.forEach((color, colorIndex) => {
      const sprite = createSprite(depth, color);
      if (sprite) cache.set(spriteKey(depth, colorIndex), sprite);
    });
  }
  return cache.size === 12 ? cache : null;
}

function drawScene(
  context: CanvasRenderingContext2D,
  bounds: LeafBounds,
  particles: LeafParticle[],
  sprites: SpriteCache,
): void {
  context.clearRect(0, 0, bounds.width, bounds.height);
  for (const particle of particles) {
    const sprite = sprites.get(spriteKey(particle.depth, particle.colorIndex));
    if (!sprite) continue;
    const opacity = particle.baseOpacity * routeOpacity(particle, bounds.height);
    if (opacity <= 0) continue;

    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(particle.rotation);
    context.scale(particle.flutter, 1);
    context.globalAlpha = opacity;
    context.drawImage(
      sprite,
      -particle.size,
      -particle.size,
      particle.size * 2,
      particle.size * 2,
    );
    context.restore();
  }
}

export function FallingLeaves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (
      !canvas ||
      typeof ResizeObserver === "undefined" ||
      typeof requestAnimationFrame === "undefined"
    ) return;

    let resolvedContext: CanvasRenderingContext2D | null = null;
    try {
      resolvedContext = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!resolvedContext) return;
    const context = resolvedContext;

    const sprites = createSpriteCache(canvas);
    if (!sprites) return;

    const random = createSeededRandom(SCENE_SEED);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motionQuery.matches;
    let bounds: LeafBounds = { width: 0, height: 0 };
    let particles: LeafParticle[] = [];
    let frameId: number | null = null;
    let lastTime = 0;
    let elapsed = 0;

    const stopLoop = () => {
      if (frameId === null) return;
      cancelAnimationFrame(frameId);
      frameId = null;
    };

    const renderFrame = (now: number) => {
      const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
      lastTime = now;
      elapsed += Math.min(Math.max(dt, 0), 0.05);
      for (const particle of particles) {
        stepLeaf(particle, bounds, dt, elapsed, random);
      }
      drawScene(context, bounds, particles, sprites);
      frameId = requestAnimationFrame(renderFrame);
    };

    const startLoop = () => {
      if (reducedMotion || document.visibilityState === "hidden" || frameId !== null) {
        return;
      }
      lastTime = 0;
      frameId = requestAnimationFrame(renderFrame);
    };

    const rebuildScene = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      bounds = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.floor(bounds.width * dpr));
      canvas.height = Math.max(1, Math.floor(bounds.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = createLeafPopulation(
        bounds,
        random,
        reducedMotion ? STATIC_LEAF_COUNT : leafCountForWidth(bounds.width),
        true,
      );
      drawScene(context, bounds, particles, sprites);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") stopLoop();
      else startLoop();
    };

    const onMotionChange = () => {
      reducedMotion = motionQuery.matches;
      stopLoop();
      rebuildScene();
      startLoop();
    };

    rebuildScene();
    startLoop();
    const resizeObserver = new ResizeObserver(rebuildScene);
    resizeObserver.observe(canvas);
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery.addEventListener("change", onMotionChange);

    return () => {
      stopLoop();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="news-leaves-canvas"
      aria-hidden="true"
    />
  );
}
```

- [ ] **Step 5: Run component and model tests and verify GREEN**

Run:

```powershell
npm.cmd test -- --run src/components/news/FallingLeaves.test.tsx src/components/news/fallingLeavesModel.test.ts
```

Expected: 2 files, 10 tests PASS.

- [ ] **Step 6: Review the component replacement**

Run:

```powershell
git diff --no-index -- .superpowers/sdd/botanical-FallingLeaves.pre.tsx frontend/src/components/news/FallingLeaves.tsx
git diff --check -- frontend/src/components/news/FallingLeaves.tsx frontend/src/components/news/FallingLeaves.test.tsx
```

Confirm the replacement:

- imports only the Task 1 model and React;
- has no density prop;
- contains no autumn palette hex literal;
- has no black stroke, shadow, animation library, or per-frame gradient;
- creates 12 sprites before the frame loop;
- cleans every listener and scheduled frame.

- [ ] **Step 7: Commit the component**

```powershell
git add frontend/src/components/news/FallingLeaves.tsx frontend/src/components/news/FallingLeaves.test.tsx
git commit -m "feat(news): render layered botanical leaves"
```

Do not stage `NewsPage.tsx`; its existing uncommitted import and usage remain
untouched.

---

### Task 3: Palette, Ambient Calibration, and CSS Contracts

**Files:**
- Modify: `frontend/src/styles/news.css`
- Modify: `frontend/src/test/news-liquid-bars.contract.test.ts`

**Interfaces:**
- Produces inherited palette variables for Task 2.
- Changes only approved ambient opacity declarations and the existing leaf
  canvas block.
- Preserves all directional micro-glint, popover, typography, feed, caustic,
  responsive, and reduced-motion hunks.

- [ ] **Step 1: Capture exact dirty-file ownership snapshots**

Run before editing:

```powershell
Copy-Item frontend/src/styles/news.css .superpowers/sdd/botanical-news.pre.css
Copy-Item frontend/src/test/news-liquid-bars.contract.test.ts .superpowers/sdd/botanical-news-contract.pre.ts
git diff -- frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts
```

- [ ] **Step 2: Add the failing botanical CSS contract**

Add this test inside the existing `describe`:

```ts
it("calibrates the botanical palette and quiet ambient field", () => {
  const defaults = newsCss.match(/\.news-page\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const ambient =
    newsCss.match(/\.news-liquid-ambient::after\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const sharedAurora =
    newsCss.match(/\.news-aurora\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const violet =
    newsCss.match(/\.news-aurora-violet\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const coral =
    newsCss.match(/\.news-aurora-coral\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const gold =
    newsCss.match(/\.news-aurora-gold\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const prism =
    newsCss.match(/\.news-aurora-prism\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const leaves =
    newsCss.match(/\.news-leaves-canvas\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  for (const [name, value] of [
    ["copper", "#b77a59"],
    ["gold", "#c0a36b"],
    ["sage", "#7f8d73"],
    ["rose", "#aa7772"],
  ]) {
    expect(defaults).toMatch(
      new RegExp(`--news-leaf-${name}:\\s*${value};`, "i"),
    );
  }
  expect(ambient).toMatch(/opacity:\s*0\.55;/);
  expect(sharedAurora).toMatch(/opacity:\s*0\.62;/);
  expect(violet).toMatch(/opacity:\s*0\.52;/);
  expect(coral).toMatch(/opacity:\s*0\.48;/);
  expect(gold).toMatch(/opacity:\s*0\.40;/);
  expect(prism).toMatch(/opacity:\s*0\.60;/);
  expect(leaves).toMatch(/z-index:\s*-1;/);
  expect(leaves).toMatch(/pointer-events:\s*none;/);
});
```

- [ ] **Step 3: Run the contract and verify RED**

Run:

```powershell
npm.cmd test -- --run src/test/news-liquid-bars.contract.test.ts
```

Expected: FAIL because the palette variables do not exist and the current
ambient opacities are `0.72`, `0.76`, `0.64`, `0.58`, `0.48`, and `0.78`.

- [ ] **Step 4: Add palette variables and exact ambient values**

Inside `.news-page`, after `--news-distortion`, add:

```css
  --news-leaf-copper: #b77a59;
  --news-leaf-gold: #c0a36b;
  --news-leaf-sage: #7f8d73;
  --news-leaf-rose: #aa7772;
```

Change only these exact declarations:

- In `.news-liquid-ambient::after`, replace `opacity: 0.72;` with
  `opacity: 0.55;`.
- In `.news-aurora`, replace `opacity: 0.76;` with `opacity: 0.62;`.
- In `.news-aurora-violet`, replace `opacity: 0.64;` with `opacity: 0.52;`.
- In `.news-aurora-coral`, replace `opacity: 0.58;` with `opacity: 0.48;`.
- In `.news-aurora-gold`, replace `opacity: 0.48;` with `opacity: 0.40;`.
- In `.news-aurora-prism`, replace `opacity: 0.78;` with `opacity: 0.60;`.

Do not edit any animation, caustic, glass, layout, or responsive declaration.

- [ ] **Step 5: Run all focused News tests and verify GREEN**

Run:

```powershell
npm.cmd test -- --run src/test/news-liquid-bars.contract.test.ts src/components/news/fallingLeavesModel.test.ts src/components/news/FallingLeaves.test.tsx src/pages/NewsPage.test.tsx
```

Expected: all four files PASS.

- [ ] **Step 6: Audit the snapshot boundary**

Run:

```powershell
git diff --no-index -- .superpowers/sdd/botanical-news.pre.css frontend/src/styles/news.css
git diff --no-index -- .superpowers/sdd/botanical-news-contract.pre.ts frontend/src/test/news-liquid-bars.contract.test.ts
git diff --check -- frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts
git diff --cached --name-only
```

Relative to the snapshots, confirm:

- CSS adds four palette variables and changes exactly six opacity values;
- the existing canvas block is unchanged;
- the test file adds exactly one botanical contract;
- neither dirty file is staged.

Leave both dirty files intentionally uncommitted to preserve the user's other
News work.

---

### Task 4: Final Verification and Visual QA

**Files:**
- Verify only.

**Interfaces:**
- Consumes the committed model/renderer and the intentionally uncommitted CSS
  integration overlay.
- Produces fresh verification evidence and a live `/news` handoff.

- [ ] **Step 1: Run typecheck**

```powershell
cd frontend
npm.cmd run typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Run the full frontend suite**

```powershell
npm.cmd test -- --run
```

Expected: every frontend test file and test PASS.

- [ ] **Step 3: Run the production build**

```powershell
npm.cmd run build
```

Expected: Vite exits 0 and writes `frontend/dist`.

- [ ] **Step 4: Inspect production ownership**

Run:

```powershell
git diff --check
git diff --cached --name-only
git status --short
```

Confirm:

- model and component commits contain only their owned files;
- dirty CSS/test snapshot boundaries still hold;
- `NewsPage.tsx` and all other pre-existing dirty files remain untouched by
  this plan;
- no dependency, stylesheet, or animation library was added.

- [ ] **Step 5: Perform visual QA**

Start the existing frontend dev server and inspect `/news` at:

- 1440 px;
- 768 px;
- 390 px;
- reduced-motion mode.

Verify:

- sparse translucent leaves with no dark outline;
- far, mid, and rare near layers are visually distinct;
- no edge teleport is visible;
- the glass command bar, smallest buttons, topic capsules, and feed cards
  remain readable;
- aurora is quieter and caustic/glass motion is unchanged;
- reduced motion shows exactly five static leaves.

If browser policy blocks automated localhost inspection, do not use another
browser-control mechanism to bypass it. Leave the dev server running, give the
user the exact `/news` URL for manual inspection, and report visual QA as
user-pending rather than claiming it passed.
