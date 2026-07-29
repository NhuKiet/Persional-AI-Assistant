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

const DEPTHS: readonly LeafDepth[] = ["far", "mid", "near"];
const STATIC_LEAF_COUNT = 5;
const SPRITE_SIZE = 64;
const SCENE_SEED = 0x1eaf;

type SpriteCache = Map<string, HTMLCanvasElement>;

function spriteKey(depth: LeafDepth, colorIndex: number): string {
  return `${depth}:${colorIndex}`;
}

function createSprite(
  depth: LeafDepth,
  color: string,
): HTMLCanvasElement | null {
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

  gradient.addColorStop(0, "rgba(255, 255, 255, 0.6)");
  gradient.addColorStop(0.34, color);
  gradient.addColorStop(1, "rgba(74, 86, 82, 0.18)");

  context.save();
  context.translate(center, center);
  context.rotate(-0.16);
  context.filter =
    DEPTH_CONFIG[depth].blur > 0
      ? `blur(${DEPTH_CONFIG[depth].blur}px)`
      : "none";

  context.beginPath();
  context.moveTo(radius * 0.08, -radius);
  context.bezierCurveTo(
    radius * 0.74,
    -radius * 0.5,
    radius * 0.55,
    radius * 0.62,
    -radius * 0.12,
    radius,
  );
  context.bezierCurveTo(
    -radius * 0.76,
    radius * 0.38,
    -radius * 0.46,
    -radius * 0.73,
    radius * 0.08,
    -radius,
  );
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.globalAlpha = 0.2;
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(radius * 0.04, -radius * 0.72);
  context.quadraticCurveTo(
    -radius * 0.08,
    0,
    -radius * 0.12,
    radius * 0.78,
  );
  context.stroke();
  context.restore();

  return sprite;
}

function createSpriteCache(canvas: HTMLCanvasElement): SpriteCache | null {
  const computed = window.getComputedStyle(canvas);
  const palette = PALETTE_VARIABLES.map((name) =>
    computed.getPropertyValue(name).trim(),
  );

  if (palette.some((color) => color.length === 0)) return null;

  const cache: SpriteCache = new Map();
  for (const depth of DEPTHS) {
    palette.forEach((color, colorIndex) => {
      const sprite = createSprite(depth, color);
      if (sprite) {
        cache.set(spriteKey(depth, colorIndex), sprite);
      }
    });
  }

  return cache.size === DEPTHS.length * PALETTE_VARIABLES.length
    ? cache
    : null;
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

    const opacity =
      particle.baseOpacity * routeOpacity(particle, bounds.height);
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

function placeStaticLeaves(
  particles: LeafParticle[],
  bounds: LeafBounds,
): void {
  particles.forEach((particle, index) => {
    particle.y = ((index + 1) / (particles.length + 1)) * bounds.height;
  });
}

export function FallingLeaves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (
      !canvas ||
      typeof ResizeObserver === "undefined" ||
      typeof requestAnimationFrame === "undefined"
    ) {
      return;
    }

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
      if (
        reducedMotion ||
        document.visibilityState === "hidden" ||
        frameId !== null
      ) {
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
      if (reducedMotion) {
        placeStaticLeaves(particles, bounds);
      }
      drawScene(context, bounds, particles, sprites);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopLoop();
      } else {
        startLoop();
      }
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
