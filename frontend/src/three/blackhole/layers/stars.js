/**
 * Sao nền tĩnh có nhấp nháy. Vị trí cố định; tần số nhấp nháy là bội nguyên
 * của 1/LOOP_SEC để vòng lặp khít.
 * Khác bản gốc: bỏ thấu kính con trỏ và phần "mờ bớt dưới tấm công thức" (app
 * không có tấm công thức, nền không nhận chuột); vùng rải sao rộng hơn vì hố
 * đen ở đây được neo lệch khỏi tâm khung (xem index.ts).
 */
import {
  BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, AdditiveBlending,
} from 'three';
import { STARS, LOOP_SEC, REF_W, REF_H } from '../config.js';
import { COMMON } from '../glsl/common.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vùng rải sao (px tham chiếu), mỗi vùng một hạt giống riêng. */
const AREAS = [
  { x0: -1400, x1: REF_W + 1400, y0: -20, y1: REF_H + 20, seed: 0 },
  { x0: -1400, x1: REF_W + 1400, y0: -620, y1: -20, seed: 1 },
  { x0: -1400, x1: REF_W + 1400, y0: REF_H + 20, y1: REF_H + 620, seed: 2 },
];

function gaussian(rnd) {
  let u = 0; let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function createStars(uniforms) {
  const pos = []; const bright = []; const sigma = []; const freq = []; const phase = [];
  const mu = Math.log(STARS.median);
  const sd = Math.log(STARS.p90 / STARS.median) / 1.2816;
  const fSteps = Math.round((STARS.fMax - STARS.fMin) * LOOP_SEC);
  let n = 0;
  for (const A of AREAS) {
    const rnd = mulberry32(STARS.seed + A.seed * 7919);
    const count = Math.round((((A.x1 - A.x0) * (A.y1 - A.y0)) / 10000) * STARS.density);
    n += count;
    for (let i = 0; i < count; i++) {
      pos.push(A.x0 + rnd() * (A.x1 - A.x0), A.y0 + rnd() * (A.y1 - A.y0), 0);
      bright.push(Math.min(STARS.max, Math.exp(mu + sd * gaussian(rnd))) / 255);
      sigma.push(STARS.sigma[0] + rnd() * (STARS.sigma[1] - STARS.sigma[0]));
      // f = k / LOOP_SEC, k nguyên → sin(2π f t) tuần hoàn với chu kỳ LOOP_SEC
      freq.push((Math.round(STARS.fMin * LOOP_SEC) + Math.floor(rnd() * (fSteps + 1))) / LOOP_SEC);
      phase.push(rnd() * Math.PI * 2);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aBright', new Float32BufferAttribute(bright, 1));
  geo.setAttribute('aSigma', new Float32BufferAttribute(sigma, 1));
  geo.setAttribute('aFreq', new Float32BufferAttribute(freq, 1));
  geo.setAttribute('aPhase', new Float32BufferAttribute(phase, 1));

  const mat = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uTwMin: { value: STARS.twinkleMin },
    },
    vertexShader: /* glsl */ `
      uniform vec2 uViewport;
      uniform float uScale;
      uniform vec2 uOrigin;
      uniform float uClock;
      uniform float uTwMin;
      attribute float aBright;
      attribute float aSigma;
      attribute float aFreq;
      attribute float aPhase;
      varying float vBright;
      varying float vSigma;
      varying float vSize;
      void main() {
        vec2 px = uOrigin + position.xy * uScale;
        gl_Position = vec4(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, 0.0, 1.0);
        float tw = mix(uTwMin, 1.0, 0.5 + 0.5 * sin(6.28318530718 * aFreq * uClock + aPhase));
        vBright = aBright * tw;
        vSigma = max(aSigma * uScale, 0.45);
        vSize = ceil(vSigma * 7.0) + 1.0;
        gl_PointSize = vSize;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying float vBright;
      varying float vSigma;
      varying float vSize;
      void main() {
        vec2 d = (gl_PointCoord - 0.5) * vSize;
        float g = exp(-dot(d, d) / (2.0 * vSigma * vSigma));
        vec2 p = scenePos(refPos());
        // che bởi bóng hố đen
        float vis = smoothstep(0.95, 1.1, length(p - uHoleCtr) / uHoleRad);
        float b = vBright * g * vis;
        gl_FragColor = vec4(vec3(b), 1.0);
      }
    `,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 0;
  return { object: pts, material: mat, count: n };
}
