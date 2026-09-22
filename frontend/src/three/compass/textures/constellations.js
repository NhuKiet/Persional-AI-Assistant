/**
 * Sinh hinh 28 chom sao (co seed co dinh) va 4 ban sao chom Bac Dau.
 */
import { mulberry32, TAU, deg } from './primitives.js';
import { SEED, CONSTELLATIONS, DIPPER, RINGS } from '../config.js';

/**
 * 28 chom sao xep deu quanh vanh, moi hinh chiem dung mot o 360/28 = 12.857 do.
 *
 * Hinh duoc sinh trong mot o vuong cuc bo roi CHUAN HOA lai cho vua khit o cua
 * no: chia theo bien do that cua cac diem chu khong nhan mot he so co dinh, nho
 * vay khong co hinh nao tran sang o ben canh hay dam vao hai vong bien.
 */
export function buildConstellations() {
  const rnd = mulberry32(SEED);
  const N = CONSTELLATIONS.count;
  const sectorArc = TAU / N;

  const rLo = RINGS.constIn + CONSTELLATIONS.margin;
  const rHi = RINGS.constOut - CONSTELLATIONS.margin;
  const rMid = (rLo + rHi) / 2;

  // nua kich thuoc toi da cua mot hinh, theo goc va theo ban kinh
  const halfArc = (sectorArc * CONSTELLATIONS.cellFill) / 2;
  const halfBand = ((rHi - rLo) * CONSTELLATIONS.bandFill) / 2;

  const out = [];
  for (let i = 0; i < N; i++) {
    const baseTh = -Math.PI / 2 + (i + 0.5) * sectorArc;
    const { pts: local, links } = makeShape(rnd);

    // chuan hoa ve [-1, 1] theo tung truc roi moi nhan len kich thuoc o
    const xs = local.map((p) => p[0]);
    const ys = local.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const sx = Math.max(1e-3, (Math.max(...xs) - Math.min(...xs)) / 2);
    const sy = Math.max(1e-3, (Math.max(...ys) - Math.min(...ys)) / 2);
    // hinh nho thi giu nho, khong keo gian cho day o
    const k = Math.min(1, 1 / Math.max(sx, sy));

    const pts = local.map(([x, y]) => {
      const u = (x - cx) * k;
      const v = (y - cy) * k;
      return [
        Math.max(rLo, Math.min(rHi, rMid + v * halfBand)),
        baseTh + u * halfArc,
      ];
    });

    const sizes = pts.map(() => (rnd() < CONSTELLATIONS.bigStarChance
      ? CONSTELLATIONS.bigStarRadius
      : CONSTELLATIONS.starRadius[0]
        + rnd() * (CONSTELLATIONS.starRadius[1] - CONSTELLATIONS.starRadius[0])));

    out.push({ pts, links, sizes });
  }
  return out;
}

/**
 * Cac dang hinh nho gon hay gap tren ban do sao co: chuoi ngan, tam giac,
 * tu giac, chu Y, hinh thang, cap sao, cung cong. Khong co duong rang cua dai.
 */
function makeShape(rnd) {
  const kinds = ['pair', 'triangle', 'chain3', 'chain4', 'quad', 'ypattern',
                 'trapezoid', 'arc', 'chain3', 'triangle', 'quad', 'chain4'];
  const kind = kinds[Math.floor(rnd() * kinds.length)];
  const j = () => (rnd() - 0.5) * 0.22; // rung nhe cho khoi qua deu
  const pts = [];
  const links = [];
  const chain = (n) => { for (let i = 1; i < n; i++) links.push([i - 1, i]); };
  const ring = (n) => { for (let i = 0; i < n; i++) links.push([i, (i + 1) % n]); };

  switch (kind) {
    case 'pair':
      pts.push([-0.7 + j(), -0.25 + j()], [0.7 + j(), 0.25 + j()]);
      chain(2);
      break;

    case 'triangle':
      pts.push([0 + j(), 0.8 + j()], [-0.75 + j(), -0.6 + j()], [0.75 + j(), -0.5 + j()]);
      ring(3);
      break;

    case 'chain3':
      pts.push([-0.8 + j(), 0.3 + j()], [0 + j(), -0.45 + j()], [0.8 + j(), 0.35 + j()]);
      chain(3);
      break;

    case 'chain4':
      pts.push([-0.85 + j(), -0.2 + j()], [-0.25 + j(), 0.45 + j()],
               [0.35 + j(), -0.35 + j()], [0.9 + j(), 0.3 + j()]);
      chain(4);
      break;

    case 'quad':
      pts.push([-0.65 + j(), 0.6 + j()], [0.7 + j(), 0.5 + j()],
               [0.6 + j(), -0.65 + j()], [-0.7 + j(), -0.55 + j()]);
      ring(4);
      break;

    case 'ypattern':
      pts.push([0 + j(), -0.75 + j()], [0 + j(), 0.05 + j()],
               [-0.7 + j(), 0.7 + j()], [0.7 + j(), 0.65 + j()]);
      links.push([0, 1], [1, 2], [1, 3]);
      break;

    case 'trapezoid':
      pts.push([-0.45 + j(), 0.7 + j()], [0.5 + j(), 0.6 + j()],
               [0.85 + j(), -0.6 + j()], [-0.8 + j(), -0.55 + j()]);
      ring(4);
      if (rnd() > 0.55) { pts.push([0.2 + j(), 0 + j()]); links.push([0, 4]); }
      break;

    case 'arc':
    default: {
      const n = 4 + Math.floor(rnd() * 3); // 4..6 sao tren mot cung cong
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1)) * Math.PI;
        pts.push([-Math.cos(t) * 0.9 + j() * 0.5, Math.sin(t) * 0.7 - 0.25 + j() * 0.5]);
      }
      chain(n);
      break;
    }
  }
  return { pts, links };
}

/**
 * Bon ban sao chom Bac Dau, moi ban xoay 90 do.
 *
 * Bon sao "gau" nam gan tam, ba sao "can" vuon ra ngoai va cong theo cung mot
 * chieu, nen bon ban gop lai thanh hinh chong chong bon canh - dung nhu ref/02.
 */
export function buildDippers() {
  const out = [];
  const { stars, links, bigStars, copies, arcOffset, arcSpan, rBowl, rTip, vScale } = DIPPER;

  for (let c = 0; c < copies; c++) {
    const base = -Math.PI / 2 + deg(arcOffset) + (c / copies) * TAU;
    const pts = stars.map(([x, y]) => [
      rBowl + x * (rTip - rBowl) + y * vScale,
      base + deg(arcSpan) * x,
    ]);
    const sizes = stars.map((_, i) =>
      (bigStars.includes(i) ? DIPPER.bigStarRadius : DIPPER.starRadius));
    out.push({ pts, links, sizes });
  }
  return out;
}

/** Vai cham sao le rai trong dai chom sao cho dai bot trong (nhu ref/01) */
export function buildFieldStars() {
  const rnd = mulberry32(SEED + 991);
  const out = [];
  const rLo = RINGS.constIn + CONSTELLATIONS.margin;
  const rHi = RINGS.constOut - CONSTELLATIONS.margin;
  for (let i = 0; i < 48; i++) {
    const r = rLo + rnd() * (rHi - rLo);
    const th = rnd() * TAU;
    out.push([r, th, CONSTELLATIONS.starRadius[0] * (0.5 + rnd() * 0.4)]);
  }
  return out;
}
