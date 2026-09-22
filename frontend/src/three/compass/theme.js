/**
 * Bang mau va phep xoay sac do.
 *
 * Sau lan tach ba kenh net, texture chi con mang CUONG DO chu khong mang mau,
 * nen doi mau chi la doi vai uniform - khong phai ve lai texture 2048x2048.
 *
 * Moi bang mau giu nguyen CAU TRUC DO SANG cua bang goc (loi sang nhat, roi den
 * quang, lop phu, khoi, nen), chi doi sac do. Nho vay phan hieu chinh do sang da
 * do theo video van dung voi moi bang mau.
 */
import * as THREE from 'three';

export const THEMES = [
  {
    id: 'vang',
    label: 'Vàng kem',
    hint: 'Màu gốc, đo theo video',
    core: '#E6DAC6', glow: '#8A6E45', wash: '#6E5638',
    star: '#B9AC9E', smoke: '#5D4F3E',
    background: '#171412', vignette: '#0B0A09',
  },
  {
    id: 'lam',
    label: 'Thiên thanh',
    hint: 'Lam lạnh, như bản đồ sao',
    core: '#C6D8E6', glow: '#45708A', wash: '#385A6E',
    star: '#9EAFB9', smoke: '#3E4F5D',
    background: '#121517', vignette: '#090A0B',
  },
  {
    id: 'luc',
    label: 'Lục ngọc',
    hint: 'Xanh ngọc bích',
    core: '#CCE6CA', glow: '#4E8A56', wash: '#3E6E48',
    star: '#A2B99F', smoke: '#405D46',
    background: '#121714', vignette: '#090B09',
  },
  {
    id: 'do',
    label: 'Chu sa',
    hint: 'Đỏ son, ấm và đậm',
    core: '#E6C9C6', glow: '#8A4E45', wash: '#6E3F38',
    star: '#B9A09E', smoke: '#5D423E',
    background: '#171312', vignette: '#0B0909',
  },
  {
    id: 'tim',
    label: 'Tử vi',
    hint: 'Tím thạch anh',
    core: '#D8C6E6', glow: '#6E458A', wash: '#58386E',
    star: '#AC9EB9', smoke: '#4E3E5D',
    background: '#151217', vignette: '#0A090B',
  },
  {
    id: 'bac',
    label: 'Ngân bạch',
    hint: 'Bạc trung tính, ánh trăng',
    core: '#E4E8EC', glow: '#6E757C', wash: '#565C62',
    star: '#C2C7CC', smoke: '#4A4F54',
    background: '#141517', vignette: '#0A0A0B',
  },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
export const DEFAULT_THEME = 'vang';

const KEYS = ['core', 'glow', 'wash', 'star', 'smoke', 'background', 'vignette'];
const _hsl = { h: 0, s: 0, l: 0 };

/**
 * Bang mau sau khi ap sac do va do bao hoa do nguoi dung chinh.
 *
 * @param {string} id
 * @param {number} hueShift  -0.5 .. 0.5 (vong sac do)
 * @param {number} satScale  0 .. 2
 * @returns {Record<string, THREE.Color>} kem 'marker' va 'moon'
 */
export function resolveTheme(id, hueShift = 0, satScale = 1) {
  const base = THEME_BY_ID[id] ?? THEME_BY_ID[DEFAULT_THEME];
  const out = {};

  for (const k of KEYS) {
    const c = new THREE.Color(base[k]);
    if (hueShift !== 0 || satScale !== 1) {
      c.getHSL(_hsl);
      c.setHSL(
        (((_hsl.h + hueShift) % 1) + 1) % 1,
        Math.min(1, _hsl.s * satScale),
        _hsl.l,
      );
    }
    out[k] = c;
  }

  // Kim chi Mat Troi va o dang tra: sang hon loi mot chut
  out.marker = out.core.clone();
  out.marker.getHSL(_hsl);
  out.marker.setHSL(_hsl.h, Math.min(1, _hsl.s * 1.8 + 0.18), Math.min(0.9, _hsl.l + 0.06));

  // Kim Mat Trang: sac do doi nghich de tach han khoi mau nen
  out.moon = out.core.clone();
  out.moon.getHSL(_hsl);
  out.moon.setHSL((_hsl.h + 0.5) % 1, Math.min(1, _hsl.s * 2.2 + 0.28), Math.min(0.92, _hsl.l + 0.08));

  return out;
}
