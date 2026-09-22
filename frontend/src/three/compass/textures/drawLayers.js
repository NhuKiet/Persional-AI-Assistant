/**
 * Ve tung lop L0-L3 thanh texture 2048x2048 bang Canvas 2D.
 * Moi lop ve rieng phan vong cua minh + lop phu nau am cua phan do.
 */
import {
  Painter, makeCanvas, packChannels, mergeStrokes, mulberry32, TAU, deg,
} from './primitives.js';
import { buildConstellations, buildDippers, buildFieldStars } from './constellations.js';
import {
  SEED, TEXTURE, RINGS, LAYERS, COLORS, FONT, DIPPER, CONSTELLATIONS,
} from '../config.js';
import { BAND_BY_ID, cellCenterAngle, cellStartAngle } from '../bands.js';

/**
 * Ve chu cua mot dai theo dung bang BANDS: o thu i, chu Han o cot 0.
 * Nho doc chung mot bang nen tooltip khi re chuot khong bao gio lech o.
 */
function bandText(P, id) {
  const b = BAND_BY_ID[id];
  const r = ((b.drawIn ?? b.rIn) + (b.drawOut ?? b.rOut)) / 2;
  for (let i = 0; i < b.count; i++) {
    P.textTangential(b.labels[i][0], r, cellCenterAngle(b, i),
      FONT[b.fontKey], FONT.family, b.alpha ?? 1, b.letterSpacing ?? 0);
  }
  return b;
}

/** Vach chia cua mot dai, dat dung tai canh cac o */
function bandDividers(P, id, r0, r1, lw, alpha) {
  const b = BAND_BY_ID[id];
  for (let i = 0; i < b.count; i++) P.spoke(r0, r1, cellStartAngle(b, i), lw, alpha);
  return b;
}

const LW = TEXTURE.lw;

/**
 * Do dam cua lop phu am theo ban kinh (r -> 0..1).
 * Cac moc duoc hieu chinh de profile mau khop voi spec/ref/01:
 * dong gop cua lop phu = stop x COLORS.innerWash.
 */
const WASH_STOPS = [
  [0.000, 0.43],
  [0.048, 0.44],
  [0.070, 0.46],
  [0.190, 0.46],
  // Dai trong giua C3 va C4: de thap han vi hai vong sang kep hai ben da roi
  // quang vao day roi. Do duoc tren video la rgb(81,65,49).
  [0.210, 0.17],
  [0.275, 0.18],
  [0.292, 0.70],
  [0.340, 0.69],
  [0.420, 0.61],
  [0.448, 0.51],
  [0.505, 0.58],
  [0.545, 0.52],
  [0.585, 0.40],
  [0.625, 0.48],
  [0.680, 0.44],
  [0.715, 0.43],
  [0.765, 0.49],
  [0.800, 0.44],
  [0.840, 0.41],
  [0.905, 0.45],
  [0.960, 0.28],
  [0.995, 0.20],
  [1.010, 0.0],
];

function washAt(r) {
  if (r >= 1.010) return 0;
  for (let i = 1; i < WASH_STOPS.length; i++) {
    if (r <= WASH_STOPS[i][0]) {
      const [r0, v0] = WASH_STOPS[i - 1];
      const [r1, v1] = WASH_STOPS[i];
      const k = (r - r0) / (r1 - r0 || 1);
      return v0 + (v1 - v0) * k;
    }
  }
  return 0;
}

/**
 * Lop phu am duoc ve TRANG ra mot texture rieng, cuong do nam o alpha; mau
 * (COLORS.innerWash) va he so sang do shader quyet dinh luc chay.
 */
function drawWash(canvas, layer, extent) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const c = size / 2;
  const scale = size / 2 / extent;
  const px = (r) => r * scale;
  const xAt = (r, th) => c + r * scale * Math.cos(th);
  const yAt = (r, th) => c + r * scale * Math.sin(th);
  ctx.clearRect(0, 0, size, size);

  // gradient theo cac moc WASH_STOPS, chi trong pham vi cua lop
  const g = ctx.createRadialGradient(c, c, 0, c, c, px(extent));
  const lo = layer.inner;
  const hi = Math.min(layer.outer + 0.018, 1.02);
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const r = (i / n) * extent;
    let a = washAt(r) * TEXTURE.washAlpha;
    // cat theo pham vi cua lop, co vien mem
    const soft = 0.012;
    const inGate = lo <= 0 ? 1 : smoothstep(lo - soft, lo + soft, r);
    const outGate = 1 - smoothstep(hi - soft, hi + soft, r);
    a *= inGate * outGate;
    g.addColorStop(Math.min(1, i / n), `rgba(255,255,255,${a.toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // van may/khoi nhe
  const rnd = mulberry32(SEED + layer.inner * 9973);
  ctx.globalCompositeOperation = 'lighter';
  const band = hi - lo;
  const nClouds = Math.max(5, Math.round(TEXTURE.washClouds * (band / 0.4)));
  for (let i = 0; i < nClouds; i++) {
    const r = lo + rnd() * band;
    const th = rnd() * TAU;
    const rad = px(band * (0.3 + rnd() * 0.75));
    const cg = ctx.createRadialGradient(xAt(r, th), yAt(r, th), 0, xAt(r, th), yAt(r, th), rad);
    const a = 0.05 + rnd() * 0.07;
    cg.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(xAt(r, th), yAt(r, th), rad, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/* ------------------------------------------------------------- noi dung lop */

/** Ve mot hinh sao: net noi mo hon, cham sao sang hon */
function drawFigure(P, fig, lineWidth, lineAlpha) {
  for (const [a, b] of fig.links) {
    P.polylinePolar([fig.pts[a], fig.pts[b]], lineWidth, lineAlpha);
  }
  for (let i = 0; i < fig.pts.length; i++) {
    P.star(fig.pts[i][0], fig.pts[i][1], fig.sizes[i], 1);
  }
}

function strokesL0(P) {
  P.setLineCap('round');

  P.ring(RINGS.C16, LW.bright, 1.0);        // vien trong dai chom sao
  P.ring(RINGS.C18, LW.normal, 0.95);       // vong ngoai cung
  P.ring(RINGS.C18 * 1.028, LW.hair, 0.25); // quang mo ben ngoai

  for (const fig of buildConstellations()) {
    drawFigure(P, fig, CONSTELLATIONS.lineWidth, CONSTELLATIONS.lineAlpha);
  }
  for (const [r, th, rad] of buildFieldStars()) P.star(r, th, rad, 0.5);
}

function strokesL1(P) {
  P.setLineCap('butt');

  P.ring(RINGS.C8, LW.bright, 1.0);
  P.ring(RINGS.C9, LW.thin, 0.85);
  P.ring(RINGS.C11, LW.normal, 0.9);
  P.ring(RINGS.C13a, LW.normal, 0.9);
  P.ring(RINGS.C13b, LW.thin, 0.8);
  P.ring(RINGS.C14, LW.bright, 1.0);

  /* -- 4 huong chinh trong dai hep 0.44-0.48 -- */
  const cardinals = bandText(P, 'cardinals');
  for (let i = 0; i < cardinals.count; i++) {
    P.spoke(RINGS.C8 + 0.004, RINGS.C8 + 0.014, cellCenterAngle(cardinals, i), LW.thin, 0.7);
  }
  // vai vach nho rai rac trong dai nay
  for (let i = 0; i < 24; i++) {
    if (i % 6 === 0) continue;
    const th = -Math.PI / 2 + (i / 24) * TAU;
    P.spoke(RINGS.C9 - 0.010, RINGS.C9 - 0.002, th, LW.hair, 0.35);
  }

  /* -- thuoc chia do (dai sang nhat) -- */
  const si = RINGS.scaleIn;
  const so = RINGS.scaleOut;
  P.ring(si, LW.normal, 0.95);
  P.ring(so, LW.thin, 0.7);
  for (let d = 0; d < 360; d++) {
    const th = deg(d) - Math.PI / 2;
    let len;
    let a;
    let lw;
    if (d % 10 === 0) { len = so - si; a = 1.0; lw = LW.normal; }
    else if (d % 5 === 0) { len = (so - si) * 0.80; a = 0.95; lw = LW.normal; }
    else { len = (so - si) * 0.62; a = 0.85; lw = LW.thin; }
    P.spoke(si, si + len, th, lw, a);
  }

  /* -- 24 tiet khi -- */
  bandDividers(P, 'terms', RINGS.C11, RINGS.C13a, LW.thin, 0.85);
  bandText(P, 'terms');

  /* -- dai ky hieu thua 0.68-0.735 -- */
  const rnd = mulberry32(SEED + 777);
  const sigils = BAND_BY_ID.sigils;
  const rs = RINGS.sigilBand;
  for (let i = 0; i < sigils.count; i++) {
    const th = cellCenterAngle(sigils, i);
    const cardinal = i % 3 === 0;
    P.ellipse(rs, th, 0.011, 0.008, th, LW.hair, cardinal ? 0.9 : 0.6);
    P.textTangential(sigils.labels[i][0], rs, th, FONT.sigil, FONT.family,
      cardinal ? 0.95 : 0.7);
    // cum "(=) 9" : them vai gach nho ben canh
    const off = 0.026;
    P.spoke(rs - 0.006, rs + 0.006, th + off / rs, LW.hair, 0.5);
    if (rnd() > 0.5) P.spoke(rs - 0.005, rs + 0.005, th - off / rs, LW.hair, 0.45);
  }

  /* -- 28 nhan nho (ten 28 tu) -- */
  bandText(P, 'lodges');
  bandDividers(P, 'lodges', RINGS.C14, RINGS.lodgeOut + 0.004, LW.hair, 0.30);
}

function strokesL2(P) {
  P.setLineCap('butt');

  P.ring(RINGS.C3, LW.normal, 0.95);
  P.ring(RINGS.C4, LW.bright, 1.0);
  P.ring(RINGS.C6, LW.normal, 0.9);

  // vach chia xuyen suot tu C4 den C8 (bien ngoai cua lop)
  bandDividers(P, 'months', RINGS.C4, LAYERS[2].outer, LW.thin, 0.9);
  bandText(P, 'months');
  bandText(P, 'stations');
}

function strokesL3(P) {
  P.setLineCap('round');

  P.ring(RINGS.C1, LW.heavy, 1.0); // vong Bac Cuc

  for (const fig of buildDippers()) {
    drawFigure(P, fig, DIPPER.lineWidth, DIPPER.lineAlpha);
  }
}

const PAINTERS = { L0: strokesL0, L1: strokesL1, L2: strokesL2, L3: strokesL3 };

/**
 * @returns {{id:string, canvas:HTMLCanvasElement, extent:number, layer:object}[]}
 */
/** Lop phu la truong tron, muot, nen khong can do phan giai cao */
const WASH_SIZE = 512;

/**
 * @returns {{id, mask, wash, strokes, extent, layer}[]}
 *   mask   texture ba kenh: R = net, G = chu, B = cham sao
 *   wash   texture mot kenh cho lop phu am
 *   strokes anh gop cua ca ba loai net, dung de lay mau hat bui
 */
export function drawAllLayers() {
  const size = TEXTURE.size;
  const out = [];

  for (const layer of LAYERS) {
    const extent = layer.outer + TEXTURE.pad;

    const strokes = {
      lines: makeCanvas(size),
      text: makeCanvas(size),
      stars: makeCanvas(size),
    };
    const ctxs = {
      lines: strokes.lines.getContext('2d'),
      text: strokes.text.getContext('2d'),
      stars: strokes.stars.getContext('2d'),
    };
    const P = new Painter(ctxs, size, extent);
    P.ink = TEXTURE.inkAlpha;
    PAINTERS[layer.id](P);

    const mask = makeCanvas(size);
    packChannels(mask, strokes, TEXTURE.glow, P.scale);

    const wash = makeCanvas(WASH_SIZE);
    drawWash(wash, layer, extent);

    const merged = makeCanvas(512);
    mergeStrokes(merged, strokes);

    out.push({ id: layer.id, mask, wash, strokes: merged, extent, layer });
  }
  return out;
}
