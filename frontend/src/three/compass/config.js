/**
 * Toan bo tham so cua hieu ung "La ban thien van".
 * Moi con so dung don vi R (ban kinh vong ngoai cung) = 1.0 trong khong gian the gioi.
 */

export const SEED = 20240917;

export const LOOP_SECONDS = 14;

/* ------------------------------------------------------------------ camera */
export const CAMERA = {
  distance: 2.9,            // xR (gan hon -> phoi canh manh hon, dung nhu ref/05)
  near: 0.1,
  far: 100,
  // Duong kinh dia / chieu cao khung. Dac ta ghi ~0.69 nhung do truc tiep tren
  // spec/ref/03 duoc 0.855 -> theo anh.
  discHeightFraction: 0.84,
};

/* ----------------------------------------------------------------- mau sac */
export const COLORS = {
  core: '#E6DAC6',        // loi net sang nhat
  dust: '#E2C79A',        // mau hat bui (am hon loi net mot chut)
  glow: '#8A6E45',        // quang quanh net (am hon mau do duoc, de bu do bao hoa)
  innerWash: '#6E5638',   // lop phu am ben trong dia (cong them vao nen)
  background: '#171412',  // nen ngoai dia
  vignette: '#0B0A09',    // mep khung
};

/* ---------------------------------------------------------------- texture */
export const TEXTURE = {
  size: 2048,   // moi lop la mot canvas 2048x2048
  pad: 0.045,   // dem quanh ban kinh ngoai cua lop de quang sang khong bi cat
  // do day net tinh theo R
  lw: {
    hair: 0.0022,
    thin: 0.0030,
    normal: 0.0040,
    bright: 0.0052,
    heavy: 0.0070,
  },
  // tint: 0 = giu mau loi (trang kem), 1 = nhuom hoan toan sang COLORS.glow
  // Quang sang lan ra 3-6px o R = 200px, tuc 0.015-0.03R.
  // tint: 0 = giu mau loi (trang kem), 1 = nhuom hoan toan sang COLORS.glow
  glow: {
    inner: { blur: 0.0050, alpha: 0.20, tint: 0.30 },
    outer: { blur: 0.0120, alpha: 0.20, tint: 0.95 },
    wide: { blur: 0.0220, alpha: 0.055, tint: 1.0 },
  },
  // Do dam chung cua net. De 1.0 thi loi net dung bang COLORS.core (#E6DAC6);
  // ha xuong se lam loi toi di truoc khi cong quang sang.
  inkAlpha: 1.0,
  washAlpha: 0.86,
  washClouds: 26, // so dom "van may" trong lop phu
};

/* -------------------------------------------------------------------- vong */
// Ban kinh do duoc tu spec/ref/01 bang profile do sang theo ban kinh.
export const RINGS = {
  C1: 0.046, // vong Bac Cuc
  dipperInner: 0.072,
  dipperOuter: 0.190,
  C3: 0.200,
  C4: 0.288, // vien trong dai 12 o
  innerCellsIn: 0.292,
  innerCellsOut: 0.346,
  C6: 0.348,
  monthIn: 0.352,
  monthOut: 0.428,
  C8: 0.431,
  cardinalBand: 0.462, // ky tu 4 huong chinh
  C9: 0.490,
  scaleIn: 0.527, // thuoc chia do
  scaleOut: 0.556,
  C11: 0.600,
  termIn: 0.606, // 24 tiet khi
  termOut: 0.662,
  C13a: 0.667,
  C13b: 0.678,
  sigilBand: 0.706, // dai ky hieu thua
  C14: 0.744,
  lodgeIn: 0.750, // 28 nhan nho
  lodgeOut: 0.792,
  C16: 0.804,
  constIn: 0.822, // dai 28 chom sao
  constOut: 0.978,
  C18: 1.0,
};

/* ------------------------------------------------------------------- layers */
// KiNg: vanh "lich ngoai" L1 cu (0.431-0.8) day gan gap doi cac vanh khac va
// chua ba nhom noi dung khong lien quan nhau, nen tach thanh ba vanh rieng -
// moi vanh tu quay, nghieng va keo duoc doc lap. Ranh gioi dat dung tai cac
// vong da ve san (C8, C11, C13a) nen de phang thi mat dia y het ban goc.
// Thu tu mang nay la chi so lop cua he hat (particles.js) - dung sap lai.
export const LAYERS = [
  { id: 'L0', name: 'Vành chòm sao', inner: 0.8, outer: 1.0 },
  { id: 'L1a', name: 'Vành 28 tú', inner: RINGS.C13a, outer: 0.8 },
  { id: 'L1b', name: 'Vành 24 tiết khí', inner: RINGS.C11, outer: RINGS.C13a },
  { id: 'L1c', name: 'Vành thước độ', inner: RINGS.C8, outer: RINGS.C11 },
  { id: 'L2', name: 'Vành 12 tháng', inner: 0.2, outer: 0.431 },
  { id: 'L3', name: 'Lõi Bắc Đẩu', inner: 0.0, outer: 0.2 },
];

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

/* ------------------------------------------------------- vanh gia khoi (rim) */
export const RIMS = {
  enabled: true,
  tube: 0.0035,
  opacity: 0.3,
  segments: 220,
};

/* ------------------------------------------------------------------ presets */
/**
 * Cac tu the dat san. Moi lop: [tiltX, tiltY, roll, spin] tinh bang do.
 *   tiltX : nghieng quanh truc ngang man hinh
 *   tiltY : nghieng quanh truc doc man hinh
 *   roll  : xoay quanh truc nhin
 *   spin  : xoay quanh phap tuyen cua chinh vanh
 * Thu tu phep xoay: Rz(roll) . Ry(tiltY) . Rx(tiltX) . Rz(spin)
 */
export const PRESETS = {
  phang: {
    label: 'Mặt phẳng',
    hint: 'Nhìn thẳng, mọi vành trùng nhau',
    pose: {
      L0: [0, 0, 0, 0], L1a: [0, 0, 0, 0], L1b: [0, 0, 0, 0], L1c: [0, 0, 0, 0],
      L2: [0, 0, 0, 0], L3: [0, 0, 0, 0],
    },
  },
  // Ba vanh L1a/L1b/L1c: L1b giu dung tu the cua L1 cu, hai vanh con lai lech
  // dan ve phia hang xom (L0 ben ngoai, L2 ben trong) de ba vanh tach ra thanh
  // ba mat phang thay vi dinh lien nhu mot.
  nghieng: {
    label: 'Nghiêng nhẹ',
    hint: 'Bắt đầu tách lớp, vẫn đọc được chữ',
    pose: {
      L0: [15, 6, -3, 4],
      L1a: [22, 9, -5, 6],
      L1b: [27, 14, -6, 8],
      L1c: [20, 26, -6, 9],
      L2: [10, 38, -5, 9],
      L3: [9, 22, -4, 6],
    },
  },
  cau: {
    label: 'Quả cầu thiên văn',
    hint: 'Các vành cắt nhau như armillary sphere',
    pose: {
      L0: [58, -10, -20, 25],
      L1a: [60, 18, -21, 28],
      L1b: [62, 46, -23, 31],
      L1c: [45, 62, -25, 38],
      L2: [28, 78, -26, 44],
      L3: [26, 70, -25, 37],
    },
  },
  det: {
    label: 'Nhìn từ cạnh',
    hint: 'Các vành dẹt thành elip rất mảnh',
    pose: {
      L0: [86, 0, -26, 20],
      L1a: [88, -1, -28, 23],
      L1b: [90, -2, -29, 26],
      L1c: [66, 45, -29, 30],
      L2: [42, 92, -29, 34],
      L3: [34, 82, -25, 28],
    },
  },
};

export const DEFAULT_PRESET = 'nghieng';

/* -------------------------------------------------------------- tuong tac */
export const INTERACTION = {
  /** do nhay khi keo mot vanh: do goc tren mot pixel chuot */
  dragDegPerPx: 0.42,
  /** do nhay khi keo giu Shift (xoay quanh phap tuyen cua vanh) */
  spinDegPerPx: 0.30,
  /** he so giam chan khi tu the chay ve muc tieu (0..1, cao = nhanh) */
  poseDamping: 0.14,
  /** khoang cach camera toi thieu / toi da, tinh theo R */
  minDistance: 1.6,
  maxDistance: 8.0,
  orbitDamping: 0.08,
  /** thoi gian chuyen canh giua hai preset (giay) */
  presetSeconds: 1.1,
};

/* ------------------------------------------------------------------- lich */
/**
 * Kinh do hoang dao (do) noi bat dau Giac tu. Dia 28 tu o day chia DEU nhau
 * nen day la xap xi - 28 tu that co "cu do" khong bang nhau.
 */
export const LODGE_ORIGIN_DEG = 204;

export const MARKERS = {
  /** kim chi co dinh o dinh khung (vi tri Mat Troi khi bat che do lich) */
  indexColor: '#FFE6A8',
  sunColor: '#FFD98A',
  moonColor: '#BFD8FF',
  highlightColor: '#FFE9BF',
  highlightAlpha: 0.30,
  needleWidth: 0.008,
};

/* --------------------------------------------------------------------- dust */
/* ----------------------------------------------------------- hat sao */
/**
 * Hat sao: it, to, tron, sang trang nga, thua den muc giua cac hat thay duoc nen
 * den. Kich thuoc cho bang DON VI R nen luon dung ti le voi dia.
 */
export const STARS = {
  count: 680,              // 400-700 o dinh pha 3D (mot phan nam ngoai khung)
  coreDiameter: 0.013,     // xR  (~4-5px khi R = 340px)
  spriteScale: 2.4,        // sprite rong gap nay lan loi, de chua quang mo
  color: '#B9AC9E',        // trang nga, trang hon khoi
  alpha: 1.0,
  /** he so gaussian: loi hep, quang rong gap doi loi */
  coreK: 16.0,             // loi: nua cuong do o dung ban kinh coreDiameter/2
  haloK: 9.0,              // quang: tat han o khoang 2x duong kinh loi
  haloGain: 0.14,
  twinkleHz: [0.5, 2.0],
  twinkleMin: 0.6,         // opacity dao dong 0.6 - 1.0
  radialFade: [1.05, 1.5], // mat do thua dan, het han o 1.5R
  spread: 0.58,            // toa rong that su, ra toi ~1.5R
  lift: 0.14,
  swirl: 0.5,
  cling: 0.30,             // bam vanh rat nhe, neu khong hat se don cuc quanh vanh
  noiseScale: 1.6,
  noiseSpeed: 0.16,
};

/* --------------------------------------------------------- khoi bui min */
/**
 * Khoi: sprite rat lon va rat mo, chong len nhau moi thanh may. Neu nhin ra
 * duoc tung hat la sai - phai tang kich thuoc va ha alpha.
 */
export const SMOKE = {
  count: 4600,
  sizeRange: [0.050, 0.140], // xR  (~22-65px o khung 1080p)
  color: '#5D4F3E',          // nau am
  alpha: 0.050,              // 0.02-0.05
  radialFade: [0.95, 1.45],
  spread: 0.30,
  lift: 0.16,
  swirl: 0.6,
  cling: 3.0,                // bam chat quanh vanh, khong troi ra phu ca khung
  veinScale: 2.2,
  veinDepth: 0.70,
  noiseScale: 1.4,
  noiseSpeed: 0.12,
};

/** He so chung cho ca hai he hat, chinh duoc luc chay */
export const DUST = {
  star: 1.0,
  smoke: 1.0,
  max: 2.5,
};

/* --------------------------------------------------------- vanh tu quay */
/**
 * Cac vanh quay cham quanh phap tuyen cua chinh no, CHIEU XEN KE nhau nen nhin
 * nhu mot bo banh rang. Toc do tinh bang do/giay; dau am la nguoc chieu kim.
 * Vanh trong quay nhanh hon vanh ngoai cho co cam giac tang toc vao tam.
 *
 * Chuyen dong nay KHONG tinh la "khuay dong" nen khong sinh bui - xem
 * PoseState.inputQuaternion().
 */
export const AUTO_SPIN = {
  enabled: true,
  speeds: { L0: 3.0, L1a: -3.8, L1b: 4.6, L1c: -5.4, L2: 6.2, L3: -8.6 },
};

/* ------------------------------------------------- bui theo chuyen dong */
/**
 * Che do tuong tac: bui bung ra khi nguoi dung KEO vanh, khong phai khi vanh
 * dang nghieng. Buong tay thi dam bui tan rong ra roi mo dan het.
 */
export const AGITATION = {
  /** toc do goc (rad/giay) ung voi muc bui day nhat */
  speedForFull: 1.7,
  /** hang so thoi gian tat dan cua bui sau khi ngung keo (giay) */
  releaseSeconds: 0.9,
  /** toc do tan rong cua dam bui (don vi 0..1 tren giay) */
  expandRate: 0.55,
  /** van tiep tuc tan rong bao nhieu khi da buong tay hoan toan */
  idleExpand: 0.45,
  /** duoi muc nay coi nhu het bui */
  deadZone: 0.012,
  /** net mo bot bao nhieu khi vanh dang toa bui */
  strokeFade: 0.45,
};

/* ------------------------------------------------------ do sang cua net */
/**
 * He so sang cho tung loai net, chinh duoc ngay luc chay (xem layerMaterial.js).
 * 1.0 la muc chuan da hieu chinh theo video. Day len tren 2 thi net chay trang
 * nhu den LED bi qua sang - co y de nguoi dung nghich.
 */
export const INK = {
  line: 1.0,   // vong, vach chia, thuoc do, net noi sao
  text: 1.0,   // chu Han
  star: 1.0,   // cham sao
  wash: 1.0,   // lop phu am trong dia
  max: 4.0,    // gioi han tren cua thanh truot
  /**
   * Cuong do bat dau / ket thuc chuyen tu mau quang sang mau loi.
   * De thap, vi mot net MANH cung co cuong do thap do khu rang cua - neu dat
   * nguong cao thi cac net manh (vi du net noi chom sao) bi doi sang mau quang
   * nau sam roi lai nhan voi chinh cuong do do, thanh ra mat hut.
   * Chi phan quang sang toa rong moi duoc mang mau am.
   */
  hotKnee: 0.06,
  hotFull: 0.34,
};

/* -------------------------------------------------------------------- bloom */
export const BLOOM = {
  strength: 0.28,
  radius: 0.40,
  threshold: 0.54,
  /**
   * Bloom chay o do phan giai thap hon khung hinh. Quang sang von da duoc ve san
   * trong texture nen bloom chi lam nhiem vu toa them phan loi sang nhat - giam
   * nua do phan giai gan nhu khong thay khac, ma re hon nhieu lan.
   */
  resolutionScale: 0.5,
};

export const GRADE = {
  // Vung quanh dia giu nguyen mau nen am #171412; chi toi dan tu 0.78 ban kinh
  // khung tro ra nen goc khung moi that su toi.
  vignetteStrength: 0.88,
  vignetteSoftness: 0.78,
  grain: 0.0,   // bo han film grain toan man hinh
  /** keo toan khung ve phia nau am, 0 = trung tinh */
  warmth: 0.55,
};

/* ---------------------------------------------------------------------- chu */
// Danh sach chu (28 tu / 24 tiet khi / 12 thang / 12 thu) nam trong src/bands.js
// vi phan tra cuu khi re chuot cung doc tu do.

export const FONT = {
  family: '"Noto Serif SC", serif',
  // co chu tinh theo R
  month: 0.042,
  innerCell: 0.0175,
  term: 0.03,
  lodge: 0.0225,
  cardinal: 0.025,
  sigil: 0.0165,
};

export const CONSTELLATIONS = {
  count: 28,
  minStars: 2,
  maxStars: 8,
  /** phan cua mot o (12.857 do) ma hinh duoc phep chiem */
  cellFill: 0.90,
  /** phan be rong dai (0.82-0.98R) ma hinh duoc phep chiem */
  bandFill: 0.90,
  /** le an toan de hinh khong cham vao hai vong bien */
  margin: 0.008,
  starRadius: [0.0042, 0.0058],
  bigStarChance: 0.28,
  bigStarRadius: 0.0072,
  lineWidth: 0.0022,   // net noi manh hon cham sao
  lineAlpha: 0.62,
};

export const DIPPER = {
  copies: 4,
  arcOffset: -14,   // do lech goc cua ban sao dau tien
  arcSpan: 78,      // goc ma mot chom quet quanh tam (do)
  rBowl: 0.068,     // ban kinh cua sao dau tien (mieng gau, gan tam)
  rTip: 0.180,      // ban kinh cua sao cuoi (dau can, vuon ra ngoai)
  vScale: 0.105,    // do lech ban kinh theo truc ngang cua chom
  starRadius: 0.0052,   // cham sao ~3px o R = 200px
  bigStarRadius: 0.0062,
  lineWidth: 0.0026,    // net noi manh hon cham sao
  lineAlpha: 0.72,
  /**
   * Bay sao chom Bac Dau, toa do chuan hoa: x doc theo chom (0 = mieng gau,
   * 1 = dau can), y ngang. Bon sao dau la "gau", ba sao cuoi la "can".
   * Ti le lay gan dung chom that (Thien Xu ... Dao Quang).
   */
  stars: [
    [0.00, 0.34],  // Thien Xu    (Dubhe)   - gau
    [0.03, 0.00],  // Thien Tuyen (Merak)   - gau
    [0.30, -0.02], // Thien Co    (Phecda)  - gau
    [0.31, 0.26],  // Thien Quyen (Megrez)  - gau
    [0.55, 0.33],  // Ngoc Hanh   (Alioth)  - can
    [0.78, 0.33],  // Khai Duong  (Mizar)   - can
    [1.00, 0.18],  // Dao Quang   (Alkaid)  - can
  ],
  /** noi 0-1-2-3-0 (gau) roi 3-4-5-6 (can) */
  links: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
  /** sao sang hon so voi cac sao con lai */
  bigStars: [0, 5],
};
