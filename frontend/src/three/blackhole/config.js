/**
 * Tham số của lớp hố đen + sao — trích từ `config.js` của project gốc `ho-den`
 * (chỉ giữ phần hai lớp này dùng; bỏ toàn bộ tấm công thức, phễu, tương tác).
 * Đơn vị px là px của khung tham chiếu 980×576 (gốc trên-trái, y hướng xuống).
 */

export const REF_W = 980;
export const REF_H = 576;

/** Bề ngang khung tham chiếu tối thiểu còn thấy được: khung hẹp (điện thoại,
 *  sidebar mở) thì scale theo chiều ngang để hố không tràn — như viewTransform gốc. */
export const MIN_VISIBLE_W = 640;

/** Điểm hội tụ F — tâm của phép dời / phóng cả hệ (uShift, uZoom) */
export const FOCUS = [474, 305];

/** Thấu kính hấp dẫn quanh con trỏ: bán kính Einstein và độ làm mềm tâm (px tham
 *  chiếu), thời gian bật / tắt dần (giây). Bản gốc (INTERACT) để 20 / 5; ở đây
 *  lớn hơn vì nền mờ và nằm sau lớp kính, 20 px gần như không thấy. */
export const LENS = { radius: 34, soft: 9, easeSec: 0.25 };

/** Chu kỳ vòng lặp (giây). Mọi tần số khác phải là bội nguyên của 1/LOOP_SEC. */
export const LOOP_SEC = 10;

/**
 * Lõi hố đen bản cuối (ho-den: hoden_final/DAC_TA_LOI_HO_DEN_BAN_CUOI.md): ray-march tia bẻ cong Schwarzschild qua một
 * đĩa khí dày phát xạ + hấp thụ (mục 6.1), tone + bảng màu đo từ ảnh tham chiếu (mục 6.3), đặt vào khung video
 * (mục 3) và ghép "screen" lên quạt công thức. Đơn vị mô hình: r_s = 1.
 */
export const BH = {
  /** tâm bóng, bán kính vòng photon R (px khung 980×576), nghiêng (độ, dương = đầu phải dải trước cao hơn) */
  center: [449, 288],
  R: 47,
  tiltDeg: 14,
  palette: 'amber', // 'amber' | 'silver'
  lowerLensedRing: true,
  /** phân giải của lượt ray-march so với canvas (tối đa, thực tế còn ≤ 576 dòng tham chiếu × resRefMul) */
  resScale: 0.5,
  resRefMul: 1.0,
  maxSteps: 240,
  /** bước trong lớp đĩa đặc (r_s); ngoài hộp |k| < box[0], |v| < box[1] (×R) không ray-march (chỉ là trời) */
  stepIn: 0.08,
  box: [7.0, 3.0],
  /** camera */
  incl: 88.0,
  camDist: 60.0,
  /**
   * đĩa: tools/target_params.json, chỉnh theo compare.py so với ref/00 — rOut 17 → 12.5 (cung trên phải cắt gọn ở
   * 1.9R, sáng ở 2.0R chỉ ~57) và q 3.2 → 2.7 cùng exposure 50 → 20 (cung trên hết cháy trắng: bão hoà 5 → 65, còn
   * dải trước vẫn đủ sáng)
   */
  rIn: 2.1, rOut: 12.5, rFade: 4.0,
  qEmis: 2.7, sFloor: 0.004,
  hz0: 0.045, hz: 0.025,
  contrast: 2.6, clumpAmp: 0.75, clumpK: 4.0,
  undersideGain: 0.22,
  kappa: 0.8, kappaDust: 1.5, dustThresh: 0.55,
  wispR0: 11.0, wispAmp: 0.03,
  kLnr: 40, kPhiCells: 16, kZ: 2.0, warpAmp: 0.12,
  /**
   * quay Kepler: φ_quay = φ + Ω0·t·r^−1.5 (độ/giây ở r = 1 r_s); lặp 10 s bằng trộn chéo 2 pha.
   * Bản sửa 02/10: ĐẢO DẤU Ω (−32) — dải trước chạy sang PHẢI, cung trên và vòng dưới sang TRÁI, để dòng công thức ôm
   * quanh hố (vượt qua đỉnh, luồn dưới đáy, đều sang trái) không chạy ngược đĩa. Độ sáng lệch trái/phải giữ nguyên.
   */
  omega0Deg: -32,
  /** trộn chéo 2 pha chỉ trong xfadeSec giây cuối vòng lặp (thay cho trọng số t/10 suốt vòng) */
  xfadeSec: 2.0,
  /**
   * vân chạy dọc cung trên / vòng dưới (ảnh phóng đại của nửa sau đĩa): số ô theo góc mỗi vòng, trọng số, hệ số tốc
   * độ so với đĩa, dấu quay khi tia nhìn mặt dưới. Theo vật lý ảnh phụ (vòng dưới) lật nên chạy sang TRÁI; đặc tả
   * mục 5 yêu cầu vòng dưới chạy sang PHẢI như cung trên → underSign = −1 (đặt 1 để về đúng vật lý).
   */
  far: { cells: 180, weight: 0.8, speed: 0.9, underSign: -1, underWeight: 2.5 },
  /**
   * kết cấu + chuyển động của dải trước (nửa trước của đĩa): cụm sáng / vệt theo (x của đĩa, v của điểm ảnh) — hai toạ độ
   * không đổi dọc tia nhìn, nên không bị trung bình hoá như vân 3 chiều — trôi dọc dải cùng chiều quay.
   *   perRs: ô nhiễu mỗi r_s dọc dải (quãng tám thô; R = 2.6 r_s) — perRs·speed·10 phải là số CHẴN để vòng lặp 10 s liền
   *     (nhiễu uốn miền dùng nửa tần số đó); warp: độ uốn miền (ô) cho các cụm không xếp thẳng theo lưới
   *   perR: ô mỗi R theo v (cắt dải thành các vệt mảnh nằm ngang); amp: độ mạnh; speed: tốc độ trôi (r_s / giây; 0.3 ≈ 5.4 px/s ở R = 47)
   */
  band: { perRs: 2, perR: 18, amp: 1.2, speed: 0.3, warp: 2.0 },
  /** tone (mục 6.3) */
  exposure: 20, gamma: 0.85, haze: 0.6, hazeSigmaR: 0.6,
  bloom: [[0.08, 0.35], [0.4, 0.28]],
  wispGain: 0.3, wispRGB: [120, 112, 118],
  /** vòng photon mảnh vẽ ở độ phân giải đầy đủ (lượt ray-march 0.5× không giữ được nét 0.035R) */
  /**
   * lowGain, lowV, lowBand: nửa DƯỚI (v từ lowV[0] → lowV[1], dưới dải trước): vòng của lượt ray-march mảnh hơn một điểm
   * ảnh nên thành chuỗi hạt rời — vành ρ = 1 ± lowBand được thay bằng nội suy theo bán kính, rồi vẽ lại vòng bằng công thức
   */
  ring: { widthR: 0.035, gain: 0.5, lowGain: 0.3, lowV: [0.2, 0.45], lowBand: 0.05 },
  /**
   * điểm đen của quầng trong khung video: bảng màu đo trên ảnh có nền xám nên L rất thấp cho ra xám xanh (vầng xám quanh
   * hố trên nền trời đen). L ≤ black[0] → đen, ≥ black[1] → giữ nguyên. Chế độ so ảnh không áp dụng.
   */
  black: [0.04, 0.24],
  /**
   * chỗ nối với quạt (chỉ trong khung video; bản sửa 02/10): dải trước mờ dần từ k = +1.3, còn 18% ở k = +1.8, để không
   * chạy ngược các dòng công thức ở mép phải. Chân phải của cung trên (v < arcFadeV) mờ theo GÓC φ quanh C (arcFadeK =
   * [φ còn a, φ đủ sáng, a]): dưới φ ≈ 46° lớp hố đen tối hơn 90, vì ở đó các dòng nhóm trên còn đang rẽ (chưa song song với
   * vân của cung); từ FUNNEL.flank[0] = 46° trở lên dòng đã nằm trên đường tròn quanh C. Mờ thoai thoải (38° → 62°) để chân
   * cung tan dần dưới các sợi trắng chứ không thành một đường cắt.
   */
  fadeK: [1.3, 1.8, 0.18],
  arcFadeK: [38, 62, 0.15],
  /** phần phía trên dải trước (chân phải của cung trên) dùng hệ số mờ của cung: hẳn khi v < arcFadeV[1], không khi v > arcFadeV[0] */
  arcFadeV: [-0.05, -0.35],
  /** chế độ so với ảnh tham chiếu (?bh_only=1&ref_frame=1): khung 665×361, không nghiêng, nền (31,32,34) */
  refFrame: { W: 665, H: 361, cx: 330.3, cy: 174.1, R: 63.5, bg: [31, 32, 34] },
};

/** độ sáng (0–255) → RGB, đo trên ảnh tham chiếu (hoden_final/tools/tone.py) */
export const LUT_AMBER = [[0, [0, 0, 0]], [25, [23, 29, 33]], [35, [31, 33, 36]], [45, [44, 42, 45]], [55, [67, 49, 48]], [65, [88, 56, 53]],
  [75, [108, 63, 54]], [85, [123, 71, 60]], [95, [139, 80, 65]], [105, [154, 88, 71]], [115, [163, 98, 83]], [125, [176, 107, 91]],
  [135, [188, 118, 99]], [145, [204, 128, 105]], [155, [220, 138, 112]], [165, [230, 149, 120]], [175, [242, 161, 128]],
  [185, [245, 173, 142]], [195, [250, 185, 153]], [205, [251, 199, 165]], [215, [251, 214, 180]], [225, [252, 230, 193]],
  [235, [252, 244, 212]], [245, [253, 252, 226]], [255, [253, 253, 248]], [255, [255, 254, 250]]];
export const LUT_SILVER = Array.from({ length: 18 }, (_, i) => [i * 15, [i * 15, i * 15, i * 15]]);

/** Sao nền (mục 7.5) */
export const STARS = {
  /** sao / 10.000 px² */
  density: 16,
  /** độ sáng đỉnh gốc: log-normal, trung vị và p90 (0–255), trần */
  median: 72,
  p90: 128,
  max: 165,
  /** bán kính gaussian (px) */
  sigma: [0.55, 0.85],
  /** nhấp nháy: opacity trong [min,1], tần số là bội nguyên của 1/LOOP_SEC trong [fMin,fMax] Hz */
  twinkleMin: 0.4,
  fMin: 0.5,
  fMax: 2.0,
  /** độ hiện của sao dưới tấm công thức */
  underSheet: 0.45,
  seed: 1337,
};
