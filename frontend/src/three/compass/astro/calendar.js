/**
 * Thien van lich: kinh do hoang dao cua Mat Troi / Mat Trang, 24 tiet khi,
 * thang kien, 28 tu va pha trang.
 *
 * Cong thuc lay tu Jean Meeus, "Astronomical Algorithms" (ban rut gon):
 *   - Mat Troi  ch.25  -> sai so ~0.01 do
 *   - Mat Trang ch.47  -> giu 9 so hang dau, sai so ~0.3 do
 * Do chinh xac nay du xa xi so voi mot o 28 tu rong 12.86 do.
 *
 * Quy uoc goc: moi ham tra ve "goc canvas" (radian) dung cung he voi Painter -
 * 0 o huong +x, chieu duong theo chieu kim dong ho tren man hinh, -PI/2 la dinh.
 */

import { LODGE_ORIGIN_DEG } from '../config.js';

const D2R = Math.PI / 180;
const norm360 = (x) => ((x % 360) + 360) % 360;
const sind = (d) => Math.sin(d * D2R);
const cosd = (d) => Math.cos(d * D2R);

/** Julian Day tu mot Date (theo gio UTC cua Date do) */
export function toJulianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function fromJulianDay(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

const julianCenturies = (jd) => (jd - 2451545.0) / 36525;

/** Kinh do hoang dao bieu kien cua Mat Troi (do, 0..360) */
export function solarLongitude(jd) {
  const T = julianCenturies(jd);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M)
    + (0.019993 - 0.000101 * T) * sind(2 * M)
    + 0.000289 * sind(3 * M);
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  return norm360(trueLong - 0.00569 - 0.00478 * sind(omega));
}

/** Kinh do hoang dao cua Mat Trang (do, 0..360) */
export function lunarLongitude(jd) {
  const T = julianCenturies(jd);
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T;
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T;

  const dL = 6.288774 * sind(Mp)
    + 1.274027 * sind(2 * D - Mp)
    + 0.658314 * sind(2 * D)
    + 0.213618 * sind(2 * Mp)
    - 0.185116 * sind(M)
    - 0.114332 * sind(2 * F)
    + 0.058793 * sind(2 * D - 2 * Mp)
    + 0.057066 * sind(2 * D - M - Mp)
    + 0.053322 * sind(2 * D + Mp)
    + 0.045758 * sind(2 * D - M)
    - 0.040923 * sind(M - Mp)
    - 0.034720 * sind(D)
    - 0.030383 * sind(M + Mp);

  return norm360(Lp + dL);
}

/* ------------------------------------------------------------- 24 tiet khi */

/**
 * Tiet khi 0 = Lap xuan, bat dau khi kinh do Mat Troi = 315 do.
 * Moi tiet khi rong dung 15 do.
 */
export const TERM_ORIGIN_DEG = 315;

/** Vi tri lien tuc trong nam tiet khi: 0..360 do, 0 = dung luc Lap xuan */
export function solarYearAngle(jd) {
  return norm360(solarLongitude(jd) - TERM_ORIGIN_DEG);
}

/** Chi so tiet khi hien tai 0..23 */
export function termIndex(jd) {
  return Math.floor(solarYearAngle(jd) / 15) % 24;
}

/** Chi so thang kien 0..11 (0 = thang Gieng, bat dau tu Lap xuan) */
export function monthIndex(jd) {
  return Math.floor(solarYearAngle(jd) / 30) % 12;
}

/**
 * Tim thoi diem Mat Troi di qua kinh do targetDeg, GAN NHAT voi jd.
 *
 * Kinh do Mat Troi tang ~0.9856 do/ngay, nen truoc het uoc luong thoi diem giao
 * bang chenh lech goc co dau (-180..180), roi moi chia doi trong cua so +/- 4
 * ngay quanh do. Neu chia doi thang tren cua so +/- 200 ngay thi ham sai lech
 * la rang cua va co the bat nham lan giao cach day nua nam.
 */
export function findSolarCrossing(jd, targetDeg) {
  const signedDiff = (t) => {
    const d = solarLongitude(t) - targetDeg;
    return ((d + 180) % 360 + 360) % 360 - 180;
  };

  const estimate = jd - signedDiff(jd) / 0.98561;
  let lo = estimate - 4;
  let hi = estimate + 4;
  if (signedDiff(lo) > 0 || signedDiff(hi) < 0) {
    // hiem khi xay ra, noi rong cua so cho chac
    lo = estimate - 12;
    hi = estimate + 12;
  }
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (signedDiff(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Moc bat dau va ket thuc cua tiet khi dang dien ra */
export function termSpan(jd) {
  const k = termIndex(jd);
  const startLon = norm360(TERM_ORIGIN_DEG + k * 15);
  const endLon = norm360(startLon + 15);
  return {
    index: k,
    start: findSolarCrossing(jd, startLon),
    end: findSolarCrossing(jd, endLon),
  };
}

/* ---------------------------------------------------------------- 28 tu */

/**
 * Dia 28 tu duoc ve thanh 28 o DEU nhau, nen o day cung chia deu 12.857 do
 * ke tu LODGE_ORIGIN_DEG (~ diem bat dau cua Giac tu). Day la xap xi: 28 tu
 * that co "cu do" khong deu.
 */
export function lodgeAngle(jd) {
  return norm360(lunarLongitude(jd) - LODGE_ORIGIN_DEG);
}

export function lodgeIndex(jd) {
  return Math.floor(lodgeAngle(jd) / (360 / 28)) % 28;
}

/* ---------------------------------------------------------------- pha trang */

export function moonPhase(jd) {
  const elong = norm360(lunarLongitude(jd) - solarLongitude(jd));
  return {
    elongation: elong,
    /** tuoi trang tinh theo ngay, 0 = soc (trang moi) */
    age: (elong / 360) * 29.530588853,
    /** ti le dien tich sang, 0..1 */
    illumination: (1 - cosd(elong)) / 2,
    waxing: elong < 180,
  };
}

export function moonPhaseName(elong) {
  const names = [
    'Sóc (trăng mới)', 'Trăng lưỡi liềm đầu', 'Thượng huyền', 'Trăng khuyết đầu',
    'Vọng (trăng tròn)', 'Trăng khuyết cuối', 'Hạ huyền', 'Trăng lưỡi liềm cuối',
  ];
  return names[Math.floor((norm360(elong) + 22.5) / 45) % 8];
}

/* -------------------------------------------- doi sang goc tren mat dia ve */

/**
 * Goc canvas (radian) ung voi mot vi tri tren vanh 24 tiet khi / 12 thang.
 * Cac o duoc ve voi o so 0 co canh truoc tai -90 - halfCell do.
 * @param {number} yearAngleDeg 0..360, tu solarYearAngle()
 */
export function solarPlateAngle(yearAngleDeg) {
  return (-90 + yearAngleDeg - 7.5) * D2R;
}

/** Goc canvas ung voi vi tri Mat Trang tren vanh 28 tu */
export function lodgePlateAngle(lodgeAngleDeg) {
  return (-90 + lodgeAngleDeg) * D2R;
}

/**
 * Goc xoay (spin, radian, quanh phap tuyen cua vanh) can dat cho cac lop de
 * dua noi dung o goc canvas theta len dinh khung hinh.
 * Diem o goc canvas theta nam o goc the gioi -theta, nen spin = PI/2 + theta.
 */
export function spinToTop(thetaCanvas) {
  return Math.PI / 2 + thetaCanvas;
}

/** Toan bo so lieu lich cho mot thoi diem */
export function calendarFor(date) {
  const jd = toJulianDay(date);
  const sunLon = solarLongitude(jd);
  const moonLon = lunarLongitude(jd);
  const yearAngle = solarYearAngle(jd);
  const span = termSpan(jd);
  const phase = moonPhase(jd);
  return {
    date,
    jd,
    sunLon,
    moonLon,
    yearAngle,
    termIndex: span.index,
    termStart: fromJulianDay(span.start),
    termEnd: fromJulianDay(span.end),
    monthIndex: monthIndex(jd),
    lodgeAngle: lodgeAngle(jd),
    lodgeIndex: lodgeIndex(jd),
    phase,
    phaseName: moonPhaseName(phase.elongation),
    /** spin can ap cho cac vanh de vi tri Mat Troi len dinh */
    plateSpin: spinToTop(solarPlateAngle(yearAngle)),
    /** goc canvas cua Mat Trang tren vanh 28 tu (truoc khi ap spin) */
    moonTheta: lodgePlateAngle(lodgeAngle(jd)),
  };
}
