/**
 * Cac ham ve co ban tren Canvas 2D, dung he toa do cuc voi don vi R.
 * Painter anh xa ban kinh r (don vi R) sang pixel cua canvas.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;
export const deg = (d) => (d * Math.PI) / 180;

/**
 * Painter tu dinh tuyen tung loai net sang mot canvas rieng:
 *   lines - vong, vach chia, thuoc do, net noi sao
 *   text  - chu Han
 *   stars - cham sao
 * Ba canvas nay sau do duoc dong goi vao ba kenh mau R/G/B cua mot texture, nho
 * vay do sang cua chu va cua cham sao chinh duoc ngay luc chay ma khong phai ve
 * lai texture.
 *
 * Net duoc ve bang mau TRANG: cuong do nam o kenh alpha, mau sac do shader quyet
 * dinh sau.
 */
export class Painter {
  /**
   * @param {{lines:CanvasRenderingContext2D, text:CanvasRenderingContext2D,
   *          stars:CanvasRenderingContext2D}} ctxs
   * @param {number} size   canh cua canvas (px)
   * @param {number} extent ban kinh (don vi R) ma nua canh canvas bao phu
   */
  constructor(ctxs, size, extent) {
    this.ctxs = ctxs;
    this.ctx = ctxs.lines;
    this.size = size;
    this.extent = extent;
    this.c = size / 2;
    this.scale = size / 2 / extent; // px tren mot don vi R
    this.ink = 1;                   // he so do dam chung cua net

    for (const c of Object.values(ctxs)) {
      c.strokeStyle = '#ffffff';
      c.fillStyle = '#ffffff';
      c.lineJoin = 'round';
    }
  }

  /** Chon canvas dich cho cac lenh ve tiep theo */
  use(cat) {
    this.ctx = this.ctxs[cat];
    return this.ctx;
  }

  /** Dat kieu duong cho ca ba canvas */
  setLineCap(cap) {
    for (const c of Object.values(this.ctxs)) c.lineCap = cap;
  }

  px(r) {
    return r * this.scale;
  }

  x(r, th) {
    return this.c + r * this.scale * Math.cos(th);
  }

  y(r, th) {
    return this.c + r * this.scale * Math.sin(th);
  }

  /* ---------------------------------------------------------------- vong */
  ring(r, lw, alpha = 1) {
    const ctx = this.use('lines');
    ctx.globalAlpha = alpha * this.ink;
    ctx.lineWidth = this.px(lw);
    ctx.beginPath();
    ctx.arc(this.c, this.c, this.px(r), 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Cung tron tu th0 den th1 (radian) */
  arc(r, th0, th1, lw, alpha = 1) {
    const ctx = this.use('lines');
    ctx.globalAlpha = alpha * this.ink;
    ctx.lineWidth = this.px(lw);
    ctx.beginPath();
    ctx.arc(this.c, this.c, this.px(r), th0, th1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Doan thang theo phuong ban kinh */
  spoke(r0, r1, th, lw, alpha = 1) {
    const ctx = this.use('lines');
    ctx.globalAlpha = alpha * this.ink;
    ctx.lineWidth = this.px(lw);
    ctx.beginPath();
    ctx.moveTo(this.x(r0, th), this.y(r0, th));
    ctx.lineTo(this.x(r1, th), this.y(r1, th));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** N vach chia deu tu r0 den r1 */
  dividers(count, r0, r1, lw, offset = 0, alpha = 1) {
    for (let i = 0; i < count; i++) {
      this.spoke(r0, r1, offset + (i / count) * TAU, lw, alpha);
    }
  }

  /** Cham sao tron co loi sang */
  star(r, th, radius, alpha = 1) {
    const ctx = this.use('stars');
    const px = this.x(r, th);
    const py = this.y(r, th);
    const rad = this.px(radius);
    ctx.globalAlpha = alpha * this.ink;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Duong gap khuc noi cac diem cho truoc, moi diem la [r, theta] */
  polylinePolar(pts, lw, alpha = 1, close = false) {
    const ctx = this.use('lines');
    if (pts.length < 2) return;
    ctx.globalAlpha = alpha * this.ink;
    ctx.lineWidth = this.px(lw);
    ctx.beginPath();
    ctx.moveTo(this.x(pts[0][0], pts[0][1]), this.y(pts[0][0], pts[0][1]));
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(this.x(pts[i][0], pts[i][1]), this.y(pts[i][0], pts[i][1]));
    }
    if (close) ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * Chu xoay theo phuong tiep tuyen, chan chu huong ve tam.
   * Nua duoi vong tron se bi lon nguoc - dung nhu video goc.
   */
  textTangential(str, r, th, fontPx, font, alpha = 1, letterSpacing = 0) {
    const ctx = this.use('text');
    ctx.save();
    ctx.globalAlpha = alpha * this.ink;
    ctx.translate(this.x(r, th), this.y(r, th));
    ctx.rotate(th + Math.PI / 2);
    ctx.font = `${this.px(fontPx)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (letterSpacing) {
      const step = this.px(fontPx) * (1 + letterSpacing);
      const total = (str.length - 1) * step;
      for (let i = 0; i < str.length; i++) {
        ctx.fillText(str[i], -total / 2 + i * step, 0);
      }
    } else {
      ctx.fillText(str, 0, 0);
    }
    ctx.restore();
  }

  /** Elip nho dung cho ky hieu */
  ellipse(r, th, rx, ry, rot, lw, alpha = 1) {
    const ctx = this.use('lines');
    ctx.save();
    ctx.globalAlpha = alpha * this.ink;
    ctx.translate(this.x(r, th), this.y(r, th));
    ctx.rotate(rot);
    ctx.lineWidth = this.px(lw);
    ctx.beginPath();
    ctx.ellipse(0, 0, this.px(rx), this.px(ry), 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Cong quang sang vao mot canvas net: quang rong -> quang hep -> loi.
 * Net ve bang mau trang nen CUONG DO nam o kenh alpha; 'lighter' cong don alpha.
 * Ket qua la mot anh trang, alpha = cuong do tong.
 */
let _scratch = null;
let _scratch2 = null;
function scratchOf(size, slot) {
  const key = slot === 2 ? '_scratch2' : '_scratch';
  let c = key === '_scratch' ? _scratch : _scratch2;
  if (!c || c.width !== size) {
    c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    if (key === '_scratch') _scratch = c; else _scratch2 = c;
  }
  return c;
}

function glowIntensity(strokeCanvas, glowCfg, scalePx, dst) {
  const ctx = dst.getContext('2d');
  const size = dst.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'lighter';
  for (const p of [glowCfg.wide, glowCfg.outer, glowCfg.inner]) {
    ctx.globalAlpha = p.alpha;
    ctx.filter = `blur(${Math.max(1, p.blur * scalePx).toFixed(2)}px)`;
    ctx.drawImage(strokeCanvas, 0, 0);
  }
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.drawImage(strokeCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return dst;
}

/**
 * Dong goi ba loai net vao ba kenh mau cua MOT texture:
 *   R = vong / vach chia / net noi sao
 *   G = chu Han
 *   B = cham sao
 * Nen la den DAC nen voi additive blending phan den khong dong gop gi.
 * Shader sau do tron lai theo he so rieng cho tung kenh.
 *
 * @param {HTMLCanvasElement} dst
 * @param {{lines,text,stars}} strokes
 */
export function packChannels(dst, strokes, glowCfg, scalePx) {
  const size = dst.width;
  const ctx = dst.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  const glow = scratchOf(size, 1);
  const tint = scratchOf(size, 2);
  const tctx = tint.getContext('2d');

  const channels = [['lines', '#ff0000'], ['text', '#00ff00'], ['stars', '#0000ff']];
  ctx.globalCompositeOperation = 'lighter';
  for (const [cat, color] of channels) {
    glowIntensity(strokes[cat], glowCfg, scalePx, glow);

    // giu alpha (= cuong do), thay mau thanh mot kenh duy nhat
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalCompositeOperation = 'source-over';
    tctx.globalAlpha = 1;
    tctx.filter = 'none';
    tctx.clearRect(0, 0, size, size);
    tctx.drawImage(glow, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, size, size);
    tctx.globalCompositeOperation = 'source-over';

    ctx.globalAlpha = 1;
    ctx.drawImage(tint, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Gop ba canvas net thanh mot anh trang duy nhat, dung de lay mau hat bui */
export function mergeStrokes(dst, strokes) {
  const ctx = dst.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, dst.width, dst.height);
  ctx.globalCompositeOperation = 'lighter';
  for (const c of Object.values(strokes)) ctx.drawImage(c, 0, 0, dst.width, dst.height);
  ctx.globalCompositeOperation = 'source-over';
  return dst;
}

export function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}
