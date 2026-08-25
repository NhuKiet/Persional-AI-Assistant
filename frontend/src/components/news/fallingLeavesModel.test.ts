import { describe, expect, it } from "vitest";
import {
  DEPTH_CONFIG,
  createLeafPopulation,
  createSeededRandom,
  depthCounts,
  leafCountForWidth,
  routeOpacity,
  stepLeaf,
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
      expect(leaf.wind).toBeGreaterThanOrEqual(3);
      expect(leaf.wind).toBeLessThanOrEqual(7);
      expect(leaf.drift).toBeGreaterThanOrEqual(2);
      expect(leaf.drift).toBeLessThanOrEqual(6);
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
    const leaf = createLeafPopulation(bounds, random, 8, true)[0];

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
