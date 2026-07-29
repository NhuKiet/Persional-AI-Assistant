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
  drift: number;
  driftFrequency: number;
  driftPhase: number;
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
  far: {
    size: [4, 7],
    opacity: [0.08, 0.16],
    fallSpeed: [8, 14],
    blur: 1.2,
  },
  mid: {
    size: [7, 11],
    opacity: [0.14, 0.26],
    fallSpeed: [12, 20],
    blur: 0.35,
  },
  near: {
    size: [10, 15],
    opacity: [0.2, 0.34],
    fallSpeed: [18, 27],
    blur: 0,
  },
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
  return {
    far,
    mid: safeTotal - far - near,
    near,
  };
}

function resetLeaf(
  leaf: LeafParticle,
  bounds: LeafBounds,
  random: RandomSource,
  initial: boolean,
): void {
  const config = DEPTH_CONFIG[leaf.depth];
  const previousSize = leaf.size;

  leaf.colorIndex = Math.floor(random() * 4);
  leaf.x = between(random, -OVERSCAN, bounds.width + OVERSCAN);
  leaf.y = initial
    ? between(random, -bounds.height * 0.08, bounds.height)
    : between(random, -Math.max(48, bounds.height * 0.14), -previousSize * 2);
  leaf.size = between(random, config.size[0], config.size[1]);
  leaf.baseOpacity = between(random, config.opacity[0], config.opacity[1]);
  leaf.fallSpeed = between(random, config.fallSpeed[0], config.fallSpeed[1]);
  leaf.wind = between(random, 3, 7);
  leaf.drift = between(random, 2, 6);
  leaf.driftFrequency = between(random, 0.22, 0.86);
  leaf.driftPhase = between(random, 0, Math.PI * 2);
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
  const config = DEPTH_CONFIG[depth];
  const leaf: LeafParticle = {
    id,
    depth,
    colorIndex: 0,
    x: 0,
    y: 0,
    size: config.size[0],
    baseOpacity: config.opacity[0],
    fallSpeed: config.fallSpeed[0],
    wind: 3,
    drift: 2,
    driftFrequency: 0.22,
    driftPhase: 0,
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
  total: number = leafCountForWidth(bounds.width),
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
  const changingDrift =
    Math.sin(elapsed * leaf.driftFrequency + leaf.driftPhase) * leaf.drift;

  leaf.x += (leaf.wind + changingDrift) * safeDt;
  leaf.y += leaf.fallSpeed * safeDt;
  leaf.rotation += leaf.rotationSpeed * safeDt;
  leaf.flutter =
    0.89 + Math.sin(elapsed * leaf.flutterSpeed + leaf.flutterPhase) * 0.11;

  const outsideBottom = leaf.y > bounds.height + leaf.size * 2;
  const outsideSide =
    leaf.x - leaf.size > bounds.width + OVERSCAN ||
    leaf.x + leaf.size < -OVERSCAN;

  if (outsideBottom || outsideSide) {
    resetLeaf(leaf, bounds, random, false);
  }
}
