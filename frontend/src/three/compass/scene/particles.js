/**
 * Hai he hat TACH BIET han nhau, khong phai mot lop nhieu phu deu:
 *
 *   StarField  - hat sao: it (400-700), to, tron, sang trang nga, co twinkle.
 *                Thua den muc giua cac hat phai thay duoc nen den.
 *   SmokeField - khoi bui: cac sprite RAT LON va RAT MO chong len nhau thanh may.
 *                Khong bao gio nhin ra tung hat. Mau nau am, day quanh cac vanh,
 *                co van khoi, nhat dan ra ngoai.
 *
 * Ca hai dung chung co che chuyen dong: lay mau tu net cua tung lop, song trong
 * he toa do cua lop nguon (nen xoay theo vanh), troi ra ngoai theo noise.
 *
 * Kich thuoc tinh bang DON VI R roi moi chieu sang pixel trong vertex shader,
 * nen hat giu dung ti le voi dia du khung to nho hay nguoi dung phong to.
 */
import * as THREE from 'three';
import { STARS, SMOKE, SEED } from '../config.js';
import { mulberry32 } from '../textures/primitives.js';

/** Lay mau cac pixel sang tu canvas net cua mot lop -> toa do cuc bo (don vi R) */
function samplePoints(strokeCanvas, extent, count, rnd, threshold) {
  const S = strokeCanvas.width;
  const ctx = strokeCanvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, S, S).data;

  const idx = [];
  for (let i = 0; i < S * S; i++) {
    if (data[i * 4 + 3] >= threshold) idx.push(i);
  }
  const out = new Float32Array(count * 2);
  if (idx.length === 0) return out;

  for (let k = 0; k < count; k++) {
    const i = idx[(rnd() * idx.length) | 0];
    const px = (i % S) + rnd();
    const py = ((i / S) | 0) + rnd();
    out[k * 2] = ((px - S / 2) / (S / 2)) * extent;
    out[k * 2 + 1] = -((py - S / 2) / (S / 2)) * extent;
  }
  return out;
}

const COMMON_VERT = /* glsl */ `
uniform float uTime;
uniform mat3  uRot[4];
uniform float uDisperse[4];
uniform float uLayerAlpha[4];
uniform float uPixelsPerUnit;
uniform float uSpread;
uniform float uLift;
uniform float uSwirl;
uniform float uCling;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uSizeMin;
uniform float uSizeMax;
uniform vec2  uRadialFade;
uniform float uRise;

attribute float aLayer;
attribute float aSize;
attribute vec3  aSeed;

varying float vAlpha;
varying float vTw;

vec3 flow(vec3 p) {
  return vec3(
    sin(p.y * 1.71 + p.z * 1.13) + 0.5 * sin(p.z * 3.7 - p.x * 2.3),
    sin(p.z * 1.93 + p.x * 1.37) + 0.5 * sin(p.x * 3.1 + p.y * 2.7),
    sin(p.x * 1.55 + p.y * 2.11) + 0.5 * sin(p.y * 3.3 - p.z * 2.1)
  ) * 0.666;
}

/** Noise vo huong, tron - dung cho van khoi */
float vein(vec3 p) {
  float a = sin(p.x * 1.7 + p.y * 1.13)
          + 0.55 * sin(p.y * 2.31 - p.z * 1.67)
          + 0.32 * sin(p.z * 3.07 + p.x * 2.21)
          + 0.18 * sin((p.x + p.y) * 4.3 - p.z * 3.9);
  return clamp(0.5 + 0.26 * a, 0.0, 1.0);
}

void main() {
  int li = int(aLayer + 0.5);
  float d = uDisperse[0];
  float la = uLayerAlpha[0];
  if (li == 1) { d = uDisperse[1]; la = uLayerAlpha[1]; }
  else if (li == 2) { d = uDisperse[2]; la = uLayerAlpha[2]; }
  else if (li == 3) { d = uDisperse[3]; la = uLayerAlpha[3]; }

  vec3 base = vec3(position.xy, 0.0);

  vec3 q = base * uNoiseScale + aSeed * 7.13 + vec3(uTime * uNoiseSpeed);
  vec3 n = flow(q);

  float r = length(base.xy) + 1e-5;
  vec2 rad = base.xy / r;
  vec2 tang = vec2(-rad.y, rad.x);
  float amt = uSpread * (0.35 + 0.65 * aSeed.x);

  vec3 offset = n * amt * 1.35;
  offset.xy += rad * amt * (0.25 + 0.55 * aSeed.y);
  offset.xy += tang * uSwirl * amt * (aSeed.z - 0.5);
  offset.z  += (aSeed.z - 0.5) * amt * 0.7;

  vec3 local = base + offset * d;
  vec3 world = uRot[0] * local;
  if (li == 1) world = uRot[1] * local;
  else if (li == 2) world = uRot[2] * local;
  else if (li == 3) world = uRot[3] * local;

  world.y += uLift * d * (0.2 + 0.8 * aSeed.y);

  // bam quanh vanh nguon: cang bi day xa vi tri goc thi cang mo
  vAlpha = la / (1.0 + uCling * length(offset * d));

  // mat do thua dan ra ngoai, het han o uRadialFade.y
  vAlpha *= 1.0 - smoothstep(uRadialFade.x, uRadialFade.y, length(world));

  // luc moi tan: bui boc len tu nua duoi cac vanh
  float edge = mix(-1.25, 1.45, uRise);
  vAlpha *= 1.0 - smoothstep(edge - 0.32, edge + 0.32, base.y);

EXTRA_VERT

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  // kich thuoc cho bang don vi R, chieu sang pixel theo phoi canh
  float worldSize = mix(uSizeMin, uSizeMax, aSize);
  gl_PointSize = max(1.0, worldSize * uPixelsPerUnit / max(0.15, -mv.z));
}
`;

const STAR_EXTRA = /* glsl */ `
  float hz = mix(uTwinkleHz.x, uTwinkleHz.y, aSeed.z);
  vTw = mix(uTwinkleMin, 1.0,
    0.5 + 0.5 * sin(uTime * 6.2831853 * hz + aSeed.x * 31.4));
`;

const SMOKE_EXTRA = /* glsl */ `
  vTw = 1.0;
  // van khoi lay theo vi tri THE GIOI nen cac dai dam nhat nam yen trong khong
  // gian trong khi hat troi qua, giong khoi cuon
  float v = vein(world * uVeinScale + vec3(uTime * uNoiseSpeed * 0.5));
  vAlpha *= mix(1.0 - uVeinDepth, 1.0 + uVeinDepth * 0.5, v);
`;

const STAR_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uColor;
uniform float uAlpha;
uniform float uOpacity;
uniform float uCoreK;
uniform float uHaloK;
uniform float uHaloGain;
varying float vAlpha;
varying float vTw;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d2 = dot(uv, uv);
  if (d2 > 0.25) discard;
  // loi gaussian hep + quang rong gap doi
  float core = exp(-d2 * uCoreK);
  float halo = exp(-d2 * uHaloK) * uHaloGain;
  float a = (core + halo) * vAlpha * vTw * uAlpha * uOpacity;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const SMOKE_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uColor;
uniform float uAlpha;
uniform float uOpacity;
varying float vAlpha;
varying float vTw;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d2 = dot(uv, uv);
  if (d2 > 0.25) discard;
  // gaussian rat mem, tat han o vien sprite - chong lop len nhau moi thanh may
  float g = exp(-d2 * 5.5) * smoothstep(0.25, 0.15, d2);
  float a = g * vAlpha * uAlpha * uOpacity;
  if (a <= 0.0012) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

class ParticleField {
  /**
   * @param {object[]} layerTextures
   * @param {'star'|'smoke'} kind
   * @param {object} cfg STARS hoac SMOKE
   */
  constructor(layerTextures, kind, cfg) {
    this.kind = kind;
    this.cfg = cfg;
    const isStar = kind === 'star';
    const rnd = mulberry32(SEED + (isStar ? 4242 : 9119));
    const n = layerTextures.length;

    // phan bo theo dien tich vanh de mat do deu
    const weights = layerTextures.map((lt) =>
      Math.max(0.05, lt.layer.outer ** 2 - lt.layer.inner ** 2));
    const wSum = weights.reduce((a, b) => a + b, 0);
    const per = weights.map((w) => Math.round((cfg.count * w) / wSum));
    const total = per.reduce((a, b) => a + b, 0);

    const pos = new Float32Array(total * 3);
    const aLayer = new Float32Array(total);
    const aSize = new Float32Array(total);
    const aSeed = new Float32Array(total * 3);

    let w = 0;
    for (let li = 0; li < n; li++) {
      const pts = samplePoints(layerTextures[li].strokes, layerTextures[li].extent,
        per[li], rnd, 24);
      for (let k = 0; k < per[li]; k++) {
        pos[w * 3] = pts[k * 2];
        pos[w * 3 + 1] = pts[k * 2 + 1];
        pos[w * 3 + 2] = 0;
        aLayer[w] = li;
        aSize[w] = rnd();
        aSeed[w * 3] = rnd();
        aSeed[w * 3 + 1] = rnd();
        aSeed[w * 3 + 2] = rnd();
        w++;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLayer', new THREE.BufferAttribute(aLayer, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.4);

    // sprite phai rong hon loi de chua quang mo
    const size = isStar
      ? [cfg.coreDiameter * cfg.spriteScale, cfg.coreDiameter * cfg.spriteScale * 1.3]
      : cfg.sizeRange;

    this.uniforms = {
      uTime: { value: 0 },
      uRot: { value: [0, 1, 2, 3].map(() => new THREE.Matrix3()) },
      uDisperse: { value: [0, 0, 0, 0] },
      uLayerAlpha: { value: [0, 0, 0, 0] },
      uPixelsPerUnit: { value: 800 },
      uSpread: { value: cfg.spread },
      uLift: { value: cfg.lift },
      uSwirl: { value: cfg.swirl },
      uCling: { value: cfg.cling },
      uNoiseScale: { value: cfg.noiseScale },
      uNoiseSpeed: { value: cfg.noiseSpeed },
      uSizeMin: { value: size[0] },
      uSizeMax: { value: size[1] },
      uRadialFade: { value: new THREE.Vector2(cfg.radialFade[0], cfg.radialFade[1]) },
      uRise: { value: 1 },
      uColor: { value: new THREE.Color(cfg.color) },
      uAlpha: { value: cfg.alpha },
      uOpacity: { value: 1 },
    };

    let extra;
    let declarations;
    if (isStar) {
      Object.assign(this.uniforms, {
        uTwinkleHz: { value: new THREE.Vector2(cfg.twinkleHz[0], cfg.twinkleHz[1]) },
        uTwinkleMin: { value: cfg.twinkleMin },
        uCoreK: { value: cfg.coreK },
        uHaloK: { value: cfg.haloK },
        uHaloGain: { value: cfg.haloGain },
      });
      extra = STAR_EXTRA;
      declarations = 'uniform vec2 uTwinkleHz;\nuniform float uTwinkleMin;\n';
    } else {
      Object.assign(this.uniforms, {
        uVeinScale: { value: cfg.veinScale },
        uVeinDepth: { value: cfg.veinDepth },
      });
      extra = SMOKE_EXTRA;
      declarations = 'uniform float uVeinScale;\nuniform float uVeinDepth;\n';
    }

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: declarations + COMMON_VERT.replace('EXTRA_VERT', extra),
      fragmentShader: isStar ? STAR_FRAG : SMOKE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = isStar ? 8 : 6; // khoi ve truoc, sao ve len tren
    this.count = total;
  }

  /**
   * He so chieu: mot doan dai mot don vi R o khoang cach mot don vi chiem bao
   * nhieu pixel tren khung.
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} drawingBufferHeight
   */
  setProjection(camera, drawingBufferHeight) {
    const halfFov = (camera.fov * Math.PI) / 360;
    this.uniforms.uPixelsPerUnit.value = (drawingBufferHeight / 2) / Math.tan(halfFov);
  }

  setColor(color) {
    this.uniforms.uColor.value.copy(color);
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

export class StarField extends ParticleField {
  constructor(layerTextures) { super(layerTextures, 'star', STARS); }
}

export class SmokeField extends ParticleField {
  constructor(layerTextures) { super(layerTextures, 'smoke', SMOKE); }
}
