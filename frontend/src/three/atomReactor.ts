/** Cảnh 3D "Capability Reactor" cho trang chủ — một lõi kim loại dày đặc bao
 *  quanh bởi 3 vành quỹ đạo, với một làn sóng năng lượng lan tỏa liên tục từ
 *  lõi ra từng vành rồi quay lại. Port từ bản demo độc lập (three.js qua CDN)
 *  sang module TS dùng gói "three" cài cục bộ, đóng gói trong một factory
 *  function thay vì state cấp module — để React StrictMode (mount/unmount/
 *  mount lại trong dev) không làm rò rỉ hay đụng độ hai instance cảnh.
 *
 *  Nền/fog đổi được qua setBackgroundColor() để khớp theme sáng/tối của app
 *  mà không phải dựng lại toàn bộ cảnh. */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Tạm ẩn sóng năng lượng lan ra 3 vành — chỉ lõi phát sáng/pulse, vành quay
// bình thường nhưng giữ nguyên màu tĩnh. Đổi lại true để bật sóng lan ra vành.
const RINGS_WAVE_ENABLED = false;

const CONFIG = {
  seed: 20260730,
  exposure: 1.14,
  fogDensity: 0.045,

  camera: {
    fov: 45,
    wide:    { z: 13.4, atomX: 2.6, atomY: 0.3, scale: 0.98 },
    desktop: { z: 12.8, atomX: 3.0, atomY: 0.45, scale: 0.92 },
    tablet:  { z: 12.8, atomX: 1.35, atomY: 0.35, scale: 0.88 },
    mobile:  { z: 13.5, atomX: 0.0, atomY: -0.6, scale: 0.82 },
    zoomMin: 7, zoomMax: 22,
  },

  core: {
    radius: 1.95,
    densityExp: 0.52,
    shardMin: 0.05, shardMax: 0.17,
    elongate: [0.55, 1.45] as [number, number],
    ivory: 0xf0ece6,
    coreMetalness: 0.08,
    coreRoughness: 0.34,
    hueJitter: 0.04, valueJitter: 0.10,
    selfSpin: 0.04,
  },

  rings: [
    { count: 760, radius: 2.80, thickness: 0.22, rotX: 0.55, rotZ: 0.20, speed:  0.20 },
    { count: 880, radius: 3.35, thickness: 0.24, rotX:-0.90, rotZ:-0.40, speed: -0.28 },
    { count: 720, radius: 3.70, thickness: 0.21, rotX: 0.20, rotZ: 1.15, speed:  0.24 },
  ],
  ringShardMin: 0.05, ringShardMax: 0.13,
  shardBevel: 0.075,
  ringMetalness: 0.14, ringRoughness: 0.4,
  ringBrightness: 1.04,

  motion: { globalY: 0.09, dragDamping: 6, parallaxMax: 0.08, parallaxDamping: 3 },

  bloom: { strength: 0.36, radius: 0.28, threshold: 0.58 },
  glowScale: 5.5,
  wave: {
    cycle: 4.8,
    bandSlots: [0, 0.245, 0.415, 0.585],
    coreSpread: 0.15,
    ringPhaseSpread: 0.15,
    fronts: 1,
    tail: 0.16,
    coreWidth: 0.065,
    ringBandWidth: 0.065,
    coreGain: 0.85,
    ringGain: 1.9,
    whiteLift: 0.1,
    ringWhiteLift: 0.62,
    coreEnergyScale: 5.0,
    coreEmissiveGain: 0.34,
    bloomGain: 0.32,
    pointGain: 2.2,
    heatOpacityGain: 0.34,
    coreOverlayRange: [0.60, 0.92] as [number, number],
    ringOverlayRange: [0.20, 0.72] as [number, number],
  },

  lights: {
    key:  { color: 0xfff2e0, intensity: 4.4, pos: [6, 8, 10] as [number, number, number] },
    rim:  { color: 0x8a7bff, intensity: 1.6, pos: [-8, -4, 4] as [number, number, number] },
    warm: { color: 0xff8a45, intensity: 3.6, pos: [2, -6, -6] as [number, number, number] },
    warmFront: { color: 0xffa662, intensity: 2.1, pos: [5, -1, 8] as [number, number, number] },
    ambient: { color: 0x4a4038, intensity: 1.5 },
    corePoint: { color: 0xffeccd, intensity: 1.3, distance: 8, decay: 1.35 },
  },
};

const QUALITY_PROFILES = {
  high:     { coreCount: 2600, ringScale: 1,    maxDpr: 1.75, bloom: true,  bloomResolutionScale: 1,    backgroundDust: 360 },
  balanced: { coreCount: 1800, ringScale: 0.72, maxDpr: 1.35, bloom: true,  bloomResolutionScale: 0.65, backgroundDust: 180 },
  low:      { coreCount: 1050, ringScale: 0.48, maxDpr: 1,    bloom: false, bloomResolutionScale: 0,    backgroundDust: 0 },
};
type ProfileName = keyof typeof QUALITY_PROFILES;
const PROFILE_ORDER: ProfileName[] = ["high", "balanced", "low"];

function createSeededRandom(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const range = (rnd: () => number, a: number, b: number) => a + rnd() * (b - a);

function detectInitialQuality(): ProfileName {
  const w = window.innerWidth, dpr = window.devicePixelRatio || 1;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4;
  let score = 0;
  if (w >= 1440) score += 2; else if (w >= 1024) score += 1;
  if (cores >= 8) score += 2; else if (cores >= 4) score += 1;
  if (mem >= 8) score += 2; else if (mem >= 4) score += 1;
  if (dpr > 2.2) score -= 1;
  if (w < 720) score -= 1;
  if (score >= 5) return "high";
  if (score >= 2) return "balanced";
  return "low";
}

interface WaveMeshUserData {
  waveMesh: THREE.InstancedMesh;
  baseMatrices: Float32Array;
  waveActive: boolean;
}

interface BandUserData {
  wavePhase?: Float32Array;
  waveAngle?: Float32Array;
  ringIndex?: number;
  baseColors: Float32Array;
  baseEmissiveIntensity: number;
  waveMesh: THREE.InstancedMesh & { userData: WaveMeshUserData };
  waveActive: boolean;
  line?: THREE.LineLoop;
  speed?: number;
  debugWaveEnergy?: number;
}

export interface AtomReactorHandle {
  setBackgroundColor(hex: number): void;
  dispose(): void;
}

export interface AtomReactorOptions {
  backgroundColor: number;
  onFail?: (err: unknown) => void;
}

export function createAtomReactor(canvas: HTMLCanvasElement, opts: AtomReactorOptions): AtomReactorHandle {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let profileName = detectInitialQuality();
  let profile = QUALITY_PROFILES[profileName];

  let renderer!: THREE.WebGLRenderer;
  let scene!: THREE.Scene;
  let camera!: THREE.PerspectiveCamera;
  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  let environmentTarget: THREE.WebGLRenderTarget | null = null;

  let atom!: THREE.Group;
  let core: (THREE.InstancedMesh & { userData: BandUserData }) | null = null;
  let rings: (THREE.InstancedMesh & { userData: BandUserData })[] = [];
  let dust: THREE.Points | null = null;
  let glowSprite: THREE.Sprite | null = null;
  let heatSprite: THREE.Sprite | null = null;
  let corePoint: (THREE.PointLight & { userData: { baseIntensity: number } }) | null = null;
  let coreMat: THREE.MeshStandardMaterial | null = null;

  const clock = new THREE.Clock();
  let rafId = 0, running = false;
  let waveTime = 0;
  let disposed = false;

  let yawBase = 0;
  const rot = { targetX: 0, targetY: 0, curX: 0, curY: 0, prevY: 0 };
  const parallax = { targetX: 0, targetY: 0, curX: 0, curY: 0 };
  let dragging = false, activePointer: number | null = null, lastPX = 0, lastPY = 0;
  let zoomZ = CONFIG.camera.desktop.z;

  const fps = { frames: 0, t0: 0, badWindows: 0, downgraded: false };
  const waveFronts: number[] = [];

  function getRenderSize() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function createRenderer() {
    const size = getRenderSize();
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    r.setClearColor(0x000000, 0);
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxDpr));
    r.setSize(size.width, size.height, false);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = CONFIG.exposure;
    r.outputColorSpace = THREE.SRGBColorSpace;
    return r;
  }

  function createEnvironmentTexture() {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 128;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#3d332b";
    g.fillRect(0, 0, cv.width, cv.height);
    const paintLight = (x: number, y: number, radius: number, inner: string, outer: string) => {
      const gradient = g.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, inner);
      gradient.addColorStop(1, outer);
      g.fillStyle = gradient;
      g.fillRect(0, 0, cv.width, cv.height);
    };
    paintLight(198, 24, 72, "rgba(255,248,236,.95)", "rgba(255,255,255,0)");
    paintLight(42, 74, 58, "rgba(126,112,246,.55)", "rgba(120,100,255,0)");
    paintLight(162, 110, 78, "rgba(255,136,64,.9)", "rgba(255,118,56,0)");
    paintLight(94, 38, 56, "rgba(255,178,112,.55)", "rgba(255,150,90,0)");
    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function createScene() {
    scene = new THREE.Scene();
    // scene.background thay vì trông cậy vào canvas trong suốt lộ CSS bg bên
    // dưới — bloom (UnrealBloomPass) làm mất kênh alpha của canvas, vùng
    // trống render ra đen đặc bất kể nền CSS đặt màu gì. Vẽ màu nền thẳng vào
    // scene mới đáng tin cậy qua mọi profile chất lượng (có/không bloom).
    scene.background = new THREE.Color(opts.backgroundColor);
    scene.fog = new THREE.FogExp2(opts.backgroundColor, CONFIG.fogDensity);
    const environmentSource = createEnvironmentTexture();
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    environmentTarget = pmrem.fromEquirectangular(environmentSource);
    scene.environment = environmentTarget.texture;
    environmentSource.dispose();
    pmrem.dispose();

    camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.1, 100);

    const L = CONFIG.lights;
    scene.add(new THREE.AmbientLight(L.ambient.color, L.ambient.intensity));
    const dir = (d: { color: number; intensity: number; pos: [number, number, number] }) => {
      const l = new THREE.DirectionalLight(d.color, d.intensity); l.position.set(...d.pos); return l;
    };
    scene.add(dir(L.key), dir(L.rim), dir(L.warm), dir(L.warmFront));

    atom = new THREE.Group();
    scene.add(atom);

    const cp = L.corePoint;
    const point = new THREE.PointLight(cp.color, cp.intensity, cp.distance, cp.decay) as THREE.PointLight & { userData: { baseIntensity: number } };
    point.userData = { baseIntensity: cp.intensity };
    corePoint = point;
    atom.add(corePoint);
  }

  function createShardGeometry() {
    return new RoundedBoxGeometry(1, 1, 1, 1, CONFIG.shardBevel);
  }

  function wrapPhase(value: number) {
    return ((value % 1) + 1) % 1;
  }

  function writeOverlayScale(waveMesh: THREE.InstancedMesh, userData: WaveMeshUserData, instanceIndex: number, scale: number) {
    const source = userData.baseMatrices;
    const target = waveMesh.instanceMatrix.array as Float32Array;
    const offset = instanceIndex * 16;
    target[offset] = source[offset] * scale;
    target[offset + 1] = source[offset + 1] * scale;
    target[offset + 2] = source[offset + 2] * scale;
    target[offset + 4] = source[offset + 4] * scale;
    target[offset + 5] = source[offset + 5] * scale;
    target[offset + 6] = source[offset + 6] * scale;
    target[offset + 8] = source[offset + 8] * scale;
    target[offset + 9] = source[offset + 9] * scale;
    target[offset + 10] = source[offset + 10] * scale;
  }

  function createWaveOverlay(mesh: THREE.InstancedMesh & { userData: BandUserData }, geometry: THREE.BufferGeometry, count: number, opacity = 0.48) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: false,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const waveMesh = new THREE.InstancedMesh(geometry, material, count) as unknown as THREE.InstancedMesh & { userData: WaveMeshUserData };
    waveMesh.frustumCulled = false;
    (waveMesh.instanceMatrix.array as Float32Array).set(mesh.instanceMatrix.array as Float32Array);
    const baseMatrices = new Float32Array(mesh.instanceMatrix.array as Float32Array);
    waveMesh.userData = { waveMesh, baseMatrices, waveActive: false };
    for (let i = 0; i < count; i++) writeOverlayScale(waveMesh, waveMesh.userData, i, 0);
    waveMesh.instanceMatrix.needsUpdate = true;
    waveMesh.renderOrder = 2;
    atom.add(waveMesh);
    mesh.userData.waveMesh = waveMesh;
    return waveMesh;
  }

  function createCore() {
    const rnd = createSeededRandom(CONFIG.seed);
    const c = CONFIG.core;
    const count = profile.coreCount;
    const geo = createShardGeometry();
    const material = new THREE.MeshStandardMaterial({
      metalness: c.coreMetalness,
      roughness: c.coreRoughness,
      vertexColors: true,
      envMapIntensity: 1.75,
      emissive: 0x8a7f74,
      emissiveIntensity: 0.16,
    });
    coreMat = material;
    const mesh = new THREE.InstancedMesh(geo, material, count) as unknown as THREE.InstancedMesh & { userData: BandUserData };
    mesh.frustumCulled = false;
    const wavePhase = new Float32Array(count);

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const base = new THREE.Color(c.ivory);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);

    for (let i = 0; i < count; i++) {
      const u = rnd(), v = rnd(), w = rnd();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const r = c.radius * Math.pow(w, c.densityExp);
      dummy.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
      dummy.rotation.set(range(rnd, 0, Math.PI), range(rnd, 0, Math.PI), range(rnd, 0, Math.PI));
      const s = range(rnd, c.shardMin, c.shardMax);
      dummy.scale.set(s * range(rnd, 0.7, 1.1), s * range(rnd, 0.7, 1.1), s * range(rnd, c.elongate[0], c.elongate[1]));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      col.setHSL(
        hsl.h + (rnd() - 0.5) * c.hueJitter,
        hsl.s,
        Math.min(1, hsl.l + (rnd() - 0.5) * c.valueJitter),
      );
      mesh.setColorAt(i, col);
      wavePhase[i] = wrapPhase(
        CONFIG.wave.bandSlots[0]
        + (r / c.radius) * CONFIG.wave.coreSpread
        + range(rnd, -0.004, 0.004),
      );
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.userData = {
      wavePhase,
      baseColors: new Float32Array(mesh.instanceColor!.array as Float32Array),
      baseEmissiveIntensity: material.emissiveIntensity,
      waveMesh: null as unknown as THREE.InstancedMesh & { userData: WaveMeshUserData },
      waveActive: false,
    };
    core = mesh;
    atom.add(core);
    createWaveOverlay(mesh, geo, count, 0.18);
  }

  function createOrbitalRing(def: typeof CONFIG.rings[number], ringIndex: number) {
    const rnd = createSeededRandom(CONFIG.seed + Math.round(def.radius * 1000));
    const count = Math.max(60, Math.round(def.count * profile.ringScale));
    const geo = createShardGeometry();
    const mat = new THREE.MeshStandardMaterial({
      metalness: CONFIG.ringMetalness,
      roughness: CONFIG.ringRoughness,
      vertexColors: true,
      envMapIntensity: 1.35,
      emissive: 0x746e72,
      emissiveIntensity: 0.12,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count) as unknown as THREE.InstancedMesh & { userData: BandUserData };
    mesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const tangent = new THREE.Vector3();
    const waveAngle = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + range(rnd, -0.05, 0.05);
      const rr = def.radius + range(rnd, -def.thickness, def.thickness);
      const y = range(rnd, -def.thickness * 0.5, def.thickness * 0.5);
      dummy.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);

      tangent.set(-Math.sin(a), 0, Math.cos(a));
      dummy.lookAt(dummy.position.clone().add(tangent));
      dummy.rotateX(range(rnd, -0.5, 0.5));
      dummy.rotateY(range(rnd, -0.35, 0.35));

      const s = range(rnd, CONFIG.ringShardMin, CONFIG.ringShardMax);
      dummy.scale.set(s * range(rnd, 0.58, 0.96), s * range(rnd, 0.58, 0.96), s * range(rnd, 1.2, 2.15));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const t = rnd(), b = CONFIG.ringBrightness;
      const lum = 0.5 + 0.62 * Math.pow(t, 1.35);
      col.setRGB(0.94 * b * lum, 0.89 * b * lum, 0.84 * b * lum);
      mesh.setColorAt(i, col);
      const slot = CONFIG.wave.bandSlots[ringIndex + 1];
      const radialPhase = (rr - def.radius) / (def.thickness * 2);
      waveAngle[i] = wrapPhase(
        slot
        + radialPhase * CONFIG.wave.ringPhaseSpread
        + range(rnd, -0.003, 0.003),
      );
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.userData = {
      waveAngle,
      ringIndex,
      baseColors: new Float32Array(mesh.instanceColor!.array as Float32Array),
      baseEmissiveIntensity: mat.emissiveIntensity,
      waveMesh: null as unknown as THREE.InstancedMesh & { userData: WaveMeshUserData },
      waveActive: false,
    };
    createWaveOverlay(mesh, geo, count);

    mesh.rotation.set(def.rotX, 0, def.rotZ);
    mesh.userData.waveMesh.rotation.copy(mesh.rotation);
    mesh.userData.speed = def.speed;
    atom.add(mesh);
    rings.push(mesh);

    if (rings.length <= 2) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 128; k++) {
        const ang = (k / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(ang) * def.radius, 0, Math.sin(ang) * def.radius));
      }
      const lg = new THREE.BufferGeometry().setFromPoints(pts);
      const lm = new THREE.LineBasicMaterial({ color: 0xd8d1c7, transparent: true, opacity: 0.08 });
      const line = new THREE.LineLoop(lg, lm);
      line.rotation.set(def.rotX, 0, def.rotZ);
      mesh.userData.line = line;
      atom.add(line);
    }
  }

  function frontSignal(phase: number, width: number) {
    const tail = CONFIG.wave.tail;
    let best = 0;
    for (let k = 0; k < waveFronts.length; k++) {
      const behind = ((waveFronts[k] - phase) % 1 + 1) % 1;
      let s;
      if (behind <= 0.5) {
        s = Math.exp(-behind / tail);
      } else {
        const ahead = (1 - behind) / width;
        s = Math.exp(-0.5 * ahead * ahead);
      }
      if (s > best) best = s;
    }
    return best;
  }

  function writeWaveColor(colors: Float32Array, baseColors: Float32Array, index: number, signal: number, gain: number, whiteLift: number) {
    const j = index * 3;
    const light = 1 + signal * gain;
    colors[j] = baseColors[j] * light + signal * whiteLift;
    colors[j + 1] = baseColors[j + 1] * light + signal * whiteLift;
    colors[j + 2] = baseColors[j + 2] * light + signal * whiteLift;
  }

  function restoreBaseColors(mesh: (THREE.InstancedMesh & { userData: BandUserData }) | null) {
    if (!mesh || !mesh.instanceColor) return;
    (mesh.instanceColor.array as Float32Array).set(mesh.userData.baseColors);
    mesh.instanceColor.needsUpdate = true;
    mesh.userData.waveActive = false;
  }

  function resetRingOverlay(mesh: (THREE.InstancedMesh & { userData: BandUserData }) | null) {
    const waveMesh = mesh && mesh.userData.waveMesh;
    if (!waveMesh || !waveMesh.userData.waveActive) return;
    for (let i = 0; i < waveMesh.count; i++) writeOverlayScale(waveMesh, waveMesh.userData, i, 0);
    waveMesh.instanceMatrix.needsUpdate = true;
    waveMesh.userData.waveActive = false;
  }

  function updateRingOverlay(mesh: THREE.InstancedMesh & { userData: BandUserData }, envelope: number) {
    const wave = CONFIG.wave;
    const colors = mesh.instanceColor!.array as Float32Array;
    const baseColors = mesh.userData.baseColors;
    const angles = mesh.userData.waveAngle!;
    const waveMesh = mesh.userData.waveMesh;
    let peakEnergy = 0;

    for (let i = 0; i < angles.length; i++) {
      const signal = frontSignal(angles[i], wave.ringBandWidth) * envelope;
      writeWaveColor(colors, baseColors, i, signal, wave.ringGain, wave.ringWhiteLift);
      const oRange = wave.ringOverlayRange;
      const overlayScale = THREE.MathUtils.smoothstep(signal, oRange[0], oRange[1]);
      writeOverlayScale(waveMesh, waveMesh.userData, i, overlayScale);
      if (signal > peakEnergy) peakEnergy = signal;
    }
    mesh.instanceColor!.needsUpdate = true;
    mesh.userData.waveActive = true;
    waveMesh.instanceMatrix.needsUpdate = true;
    waveMesh.userData.waveActive = true;
    return peakEnergy;
  }

  function updateCoreWave() {
    if (!core || !core.instanceColor) return 0;
    const wave = CONFIG.wave;
    const colors = core.instanceColor.array as Float32Array;
    const phases = core.userData.wavePhase!;
    const baseColors = core.userData.baseColors;
    let shellEnergy = 0;

    const waveMesh = core.userData.waveMesh;
    for (let i = 0; i < phases.length; i++) {
      const signal = frontSignal(phases[i], wave.coreWidth);
      writeWaveColor(colors, baseColors, i, signal, wave.coreGain, wave.whiteLift);
      if (waveMesh) {
        const r = wave.coreOverlayRange;
        writeOverlayScale(waveMesh, waveMesh.userData, i, THREE.MathUtils.smoothstep(signal, r[0], r[1]));
      }
      shellEnergy += signal;
    }
    core.instanceColor.needsUpdate = true;
    core.userData.waveActive = true;
    if (waveMesh) {
      waveMesh.instanceMatrix.needsUpdate = true;
      waveMesh.userData.waveActive = true;
    }

    const bandEnergy = shellEnergy / phases.length;
    const shellSignal = Math.min(1, bandEnergy * wave.coreEnergyScale);

    coreMat!.emissiveIntensity = core.userData.baseEmissiveIntensity + shellSignal * wave.coreEmissiveGain;

    if (corePoint) corePoint.intensity = corePoint.userData.baseIntensity + shellSignal * wave.pointGain;
    if (heatSprite) {
      const mat = heatSprite.material as THREE.SpriteMaterial;
      const ud = heatSprite.userData as { baseOpacity: number; baseScale: number };
      mat.opacity = ud.baseOpacity + shellSignal * wave.heatOpacityGain;
      heatSprite.scale.setScalar(ud.baseScale * (1 + shellSignal * 0.16));
    }
    if (glowSprite) {
      const mat = glowSprite.material as THREE.SpriteMaterial;
      const ud = glowSprite.userData as { baseOpacity: number };
      mat.opacity = ud.baseOpacity * (1 + shellSignal * 0.4);
      glowSprite.scale.setScalar(CONFIG.glowScale * (1 + shellSignal * 0.07));
    }
    return shellSignal;
  }

  function updateRingWave(mesh: THREE.InstancedMesh & { userData: BandUserData }) {
    if (!mesh || !mesh.instanceColor) return 0;
    const wave = CONFIG.wave;
    const phases = mesh.userData.waveAngle;
    if (!phases) return 0;

    const slot = wave.bandSlots[mesh.userData.ringIndex! + 1];
    const leadReach = wave.ringBandWidth * 4;
    const trailReach = wave.tail * 5;
    let inReach = false;
    for (let k = 0; k < waveFronts.length; k++) {
      const behind = ((waveFronts[k] - slot) % 1 + 1) % 1;
      if (behind <= trailReach || (1 - behind) <= leadReach) { inReach = true; break; }
    }
    if (!inReach) {
      if (mesh.userData.waveActive) { restoreBaseColors(mesh); resetRingOverlay(mesh); }
      mesh.userData.debugWaveEnergy = 0;
      return 0;
    }

    const energy = updateRingOverlay(mesh, 1);
    mesh.userData.debugWaveEnergy = energy;
    return energy;
  }

  function updateCapabilityWave(dt: number) {
    waveTime += dt;
    const wave = CONFIG.wave;
    const lead = (waveTime / wave.cycle) % 1;
    waveFronts.length = 0;
    for (let k = 0; k < wave.fronts; k++) waveFronts.push((lead + k / wave.fronts) % 1);

    let peakEnergy = updateCoreWave();
    if (RINGS_WAVE_ENABLED) {
      for (const ring of rings) peakEnergy = Math.max(peakEnergy, updateRingWave(ring));
    }

    if (bloomPass) bloomPass.strength = CONFIG.bloom.strength * (1 + peakEnergy * wave.bloomGain);
  }

  function createHeatTexture() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 192;
    const g = cv.getContext("2d")!;
    const grd = g.createRadialGradient(96, 96, 0, 96, 96, 96);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.16, "rgba(255,248,225,.92)");
    grd.addColorStop(0.42, "rgba(220,214,255,.34)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 192, 192);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeGlowTexture() {
    const cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const g = cv.getContext("2d")!;
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, "rgba(255,255,255,.92)");
    grd.addColorStop(0.25, "rgba(222,220,255,.5)");
    grd.addColorStop(0.55, "rgba(150,140,255,.16)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }

  function createAtmosphere() {
    const n = profile.backgroundDust;
    if (n > 0) {
      const rnd = createSeededRandom(CONFIG.seed + 99);
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = range(rnd, -16, 16);
        pos[i * 3 + 1] = range(rnd, -11, 11);
        pos[i * 3 + 2] = range(rnd, -13, 5);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8f8fa0, size: 0.028, transparent: true, opacity: 0.42, depthWrite: false }));
      scene.add(dust);
    }
    const heatOpacity = prefersReduced ? 0.3 : 0.14;
    heatSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: createHeatTexture(),
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: heatOpacity,
    }));
    heatSprite.scale.setScalar(2.1);
    heatSprite.renderOrder = 1;
    heatSprite.userData = { baseOpacity: heatOpacity, baseScale: 2.1 };
    atom.add(heatSprite);

    const opacity = profile.bloom ? 0.24 : 0.52;
    glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, opacity }));
    glowSprite.scale.setScalar(CONFIG.glowScale);
    glowSprite.userData = { baseOpacity: opacity };
    atom.add(glowSprite);
  }

  function disposeComposer() {
    if (composer) {
      composer.passes.forEach(p => p.dispose && p.dispose());
      composer.dispose();
      composer = null;
    }
  }

  function createPostProcessing() {
    disposeComposer();
    if (!profile.bloom) { composer = null; return; }
    composer = new EffectComposer(renderer);
    const size = getRenderSize();
    const scale = profile.bloomResolutionScale || 1;
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxDpr) * scale);
    composer.setSize(size.width, size.height);
    const renderPass = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), CONFIG.bloom.strength, CONFIG.bloom.radius, CONFIG.bloom.threshold);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
  }

  function currentLayout() {
    const w = window.innerWidth;
    if (w >= 1300) return CONFIG.camera.wide;
    if (w <= 720) return CONFIG.camera.mobile;
    if (w <= 899) return CONFIG.camera.tablet;
    return CONFIG.camera.desktop;
  }
  function applyLayout() {
    const L = currentLayout();
    const size = getRenderSize();
    atom.position.set(L.atomX, L.atomY, 0);
    atom.scale.setScalar(L.scale);
    zoomZ = THREE.MathUtils.clamp(zoomZ, CONFIG.camera.zoomMin, CONFIG.camera.zoomMax);
    camera.position.set(0, 0, L.z);
    zoomZ = L.z;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }

  function onDown(e: PointerEvent) {
    dragging = true; activePointer = e.pointerId;
    lastPX = e.clientX; lastPY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }
  function onMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== activePointer) return;
    rot.targetY += (e.clientX - lastPX) * 0.006;
    rot.targetX += (e.clientY - lastPY) * 0.006;
    rot.targetX = THREE.MathUtils.clamp(rot.targetX, -0.9, 0.9);
    lastPX = e.clientX; lastPY = e.clientY;
  }
  function onHover(e: PointerEvent) {
    if (dragging) return;
    parallax.targetX = (e.clientY / window.innerHeight - 0.5) * CONFIG.motion.parallaxMax;
    parallax.targetY = (e.clientX / window.innerWidth - 0.5) * CONFIG.motion.parallaxMax;
  }
  function onUp(e: PointerEvent) {
    if (e.pointerId !== activePointer && activePointer !== null) return;
    dragging = false; activePointer = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }
  function onWheel(e: WheelEvent) {
    const r = canvas.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) return;
    e.preventDefault();
    zoomZ = THREE.MathUtils.clamp(zoomZ + e.deltaY * 0.01, CONFIG.camera.zoomMin, CONFIG.camera.zoomMax);
  }
  let resizeRaf = 0;
  function onResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const size = getRenderSize();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxDpr));
      renderer.setSize(size.width, size.height, false);
      if (composer) {
        composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxDpr) * (profile.bloomResolutionScale || 1));
        composer.setSize(size.width, size.height);
      }
      applyLayout();
    });
  }
  function onVisibility() {
    if (document.hidden) stop();
    else if (!running) { clock.getDelta(); start(); }
  }

  function buildWorldForProfile() {
    createCore();
    CONFIG.rings.forEach((def, i) => createOrbitalRing(def, i));
    createAtmosphere();
    createPostProcessing();
    applyLayout();
  }
  function disposeWorld() {
    const kill = (obj: THREE.Object3D | null | undefined) => {
      if (!obj) return;
      atom.remove(obj); scene.remove(obj);
      const anyObj = obj as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      if (anyObj.geometry) anyObj.geometry.dispose();
      if (anyObj.material) {
        (Array.isArray(anyObj.material) ? anyObj.material : [anyObj.material]).forEach(m => {
          const mm = m as THREE.Material & { map?: THREE.Texture | null };
          if (mm.map) mm.map.dispose();
          mm.dispose();
        });
      }
    };
    if (core) {
      const coreWave = core.userData.waveMesh;
      if (coreWave) { atom.remove(coreWave); (coreWave.material as THREE.Material).dispose(); }
      kill(core);
    }
    rings.forEach(r => {
      const waveMesh = r.userData.waveMesh;
      if (waveMesh) { atom.remove(waveMesh); (waveMesh.material as THREE.Material).dispose(); }
      kill(r.userData.line);
      kill(r);
    });
    kill(dust); kill(heatSprite); kill(glowSprite);
    core = null; rings = []; dust = null; heatSprite = null; glowSprite = null;
  }

  function applyQualityProfile(name: ProfileName) {
    profileName = name; profile = QUALITY_PROFILES[name];
    const size = getRenderSize();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxDpr));
    renderer.setSize(size.width, size.height, false);
    disposeWorld();
    buildWorldForProfile();
  }
  function maybeDowngrade() {
    if (fps.downgraded || prefersReduced) return;
    const idx = PROFILE_ORDER.indexOf(profileName);
    if (idx >= PROFILE_ORDER.length - 1) return;
    fps.badWindows++;
    if (fps.badWindows >= 3) {
      fps.downgraded = true;
      applyQualityProfile(PROFILE_ORDER[idx + 1]);
    }
  }

  function animate() {
    rafId = requestAnimationFrame(animate);
    let dt = clock.getDelta();
    if (dt > 0.05) dt = 0.05;
    const t = clock.elapsedTime;

    if (!prefersReduced) {
      updateCapabilityWave(dt);

      const ad = 1 - Math.exp(-CONFIG.motion.dragDamping * dt);
      rot.curX += (rot.targetX - rot.curX) * ad;
      rot.curY += (rot.targetY - rot.curY) * ad;
      const pd = 1 - Math.exp(-CONFIG.motion.parallaxDamping * dt);
      parallax.curX += (parallax.targetX - parallax.curX) * pd;
      parallax.curY += (parallax.targetY - parallax.curY) * pd;

      const autoY = dragging ? 0 : CONFIG.motion.globalY * dt;
      const dragDeltaY = rot.curY - rot.prevY;
      rot.prevY = rot.curY;
      yawBase += autoY + dragDeltaY;
      atom.rotation.set(rot.curX + parallax.curX, yawBase + parallax.curY, 0);

      for (const r of rings) {
        r.rotation.y += (r.userData.speed || 0) * dt;
        const waveMesh = r.userData.waveMesh;
        if (waveMesh) waveMesh.rotation.copy(r.rotation);
        if (r.userData.line) r.userData.line.rotation.y = r.rotation.y;
      }
      if (core) {
        core.rotation.y += CONFIG.core.selfSpin * dt;
        const coreWave = core.userData.waveMesh;
        if (coreWave) coreWave.rotation.copy(core.rotation);
      }
    }

    const zd = 1 - Math.exp(-4 * dt);
    camera.position.z += (zoomZ - camera.position.z) * zd;
    camera.lookAt(0, 0, 0);

    if (composer) composer.render(); else renderer.render(scene, camera);

    fps.frames++;
    if (t - fps.t0 >= 1.5) {
      const avg = fps.frames / (t - fps.t0);
      const threshold = profileName === "low" ? 26 : 40;
      if (avg < threshold) maybeDowngrade(); else fps.badWindows = 0;
      fps.frames = 0; fps.t0 = t;
    }
  }
  function start() { if (running) return; running = true; animate(); }
  function stop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  function bindInteractions() {
    canvas.style.touchAction = "pan-y";
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    window.addEventListener("pointermove", onHover);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
  }
  function unbindInteractions() {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointermove", onHover);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
    canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
  }

  function setBackgroundColor(hex: number) {
    if (!scene) return;
    if (scene.background instanceof THREE.Color) scene.background.setHex(hex);
    if (scene.fog) (scene.fog as THREE.FogExp2).color.setHex(hex);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    unbindInteractions();
    disposeWorld();
    disposeComposer();
    if (environmentTarget) { environmentTarget.dispose(); environmentTarget = null; }
    if (renderer) renderer.dispose();
  }

  try {
    renderer = createRenderer();
    createScene();
    buildWorldForProfile();
    bindInteractions();
    camera.position.set(0, 0, zoomZ);
    const activeComposer = composer as EffectComposer | null;
    if (activeComposer) activeComposer.render(); else renderer.render(scene, camera);
    clock.getDelta(); fps.t0 = clock.elapsedTime;
    start();
  } catch (err) {
    opts.onFail?.(err);
  }

  return { setBackgroundColor, dispose };
}
