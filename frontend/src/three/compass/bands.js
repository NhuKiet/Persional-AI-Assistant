/**
 * Bang cac DAI tren mat dia - mot nguon su that duy nhat cho ca phan ve texture
 * lan phan tra cuu khi re chuot. Neu chi sua o mot cho thi tooltip se chi sai o,
 * nen moi thu ve theo o deu doc tu day.
 *
 *   rIn, rOut     pham vi ban kinh de BAT su kien chuot (phu kin mat dia)
 *   drawIn/Out    pham vi ban kinh thuc su ve noi dung
 *   count         so o
 *   startDeg      goc canvas (do) cua canh truoc o so 0; -90 la dinh
 *   labels        [chu Han, phien am / nghia]
 */
import { RINGS, LAYERS, LAYER_BY_ID } from './config.js';

const cell = (count) => 360 / count;

export const BANDS = [
  {
    id: 'core',
    layer: 'L3',
    title: 'Lõi — Bắc Đẩu',
    rIn: 0,
    rOut: 0.2,
    count: 0,
    note: 'Vòng sao Bắc Cực và bốn bản sao chòm Bắc Đẩu, cán sao chỉ bốn mùa.',
  },
  {
    id: 'gap',
    layer: 'L2',
    title: 'Dải trống',
    rIn: 0.2,
    rOut: RINGS.C4,
    count: 0,
    note: 'Dải tối ngăn cách vùng Bắc Đẩu với vành 12 tháng.',
  },
  {
    id: 'stations',
    layer: 'L2',
    title: 'Thập nhị thứ',
    rIn: RINGS.C4,
    rOut: RINGS.C6,
    drawIn: RINGS.innerCellsIn,
    drawOut: RINGS.innerCellsOut,
    count: 12,
    startDeg: -90 - cell(12) / 2,
    fontKey: 'innerCell',
    letterSpacing: 0.22,
    alpha: 0.8,
    labels: [
      ['寅析木', 'Dần — Tích Mộc'],
      ['卯大火', 'Mão — Đại Hỏa'],
      ['辰壽星', 'Thìn — Thọ Tinh'],
      ['巳鶉尾', 'Tỵ — Thuần Vĩ'],
      ['午鶉火', 'Ngọ — Thuần Hỏa'],
      ['未鶉首', 'Mùi — Thuần Thủ'],
      ['申實沈', 'Thân — Thực Trầm'],
      ['酉大梁', 'Dậu — Đại Lương'],
      ['戌降婁', 'Tuất — Giáng Lâu'],
      ['亥娵訾', 'Hợi — Tưu Tư'],
      ['子玄枵', 'Tý — Huyền Hiêu'],
      ['丑星紀', 'Sửu — Tinh Kỷ'],
    ],
    note: 'Mười hai thứ ghép với mười hai địa chi, chia hoàng đạo thành 12 cung.',
  },
  {
    id: 'months',
    layer: 'L2',
    title: 'Mười hai tháng',
    rIn: RINGS.C6,
    rOut: RINGS.C8,
    drawIn: RINGS.monthIn,
    drawOut: RINGS.monthOut,
    count: 12,
    startDeg: -90 - cell(12) / 2,
    fontKey: 'month',
    letterSpacing: 0.08,
    alpha: 1.0,
    labels: [
      ['正月', 'tháng Giêng'], ['二月', 'tháng Hai'], ['三月', 'tháng Ba'],
      ['四月', 'tháng Tư'], ['五月', 'tháng Năm'], ['六月', 'tháng Sáu'],
      ['七月', 'tháng Bảy'], ['八月', 'tháng Tám'], ['九月', 'tháng Chín'],
      ['十月', 'tháng Mười'], ['冬月', 'tháng Một (Đông)'], ['臘月', 'tháng Chạp (Lạp)'],
    ],
    note: 'Tháng kiến, mỗi tháng gồm hai tiết khí. Tháng Giêng bắt đầu từ Lập xuân.',
  },
  {
    id: 'cardinals',
    layer: 'L1c',
    title: 'Bốn hướng chính',
    rIn: RINGS.C8,
    rOut: RINGS.C9,
    drawIn: RINGS.cardinalBand,
    drawOut: RINGS.cardinalBand,
    count: 4,
    startDeg: -90 - cell(4) / 2,
    fontKey: 'cardinal',
    alpha: 0.95,
    labels: [['北', 'Bắc'], ['東', 'Đông'], ['南', 'Nam'], ['西', 'Tây']],
    note: 'Bốn phương định hướng cho toàn bộ mặt đĩa.',
  },
  {
    id: 'scale',
    layer: 'L1c',
    title: 'Thước chia độ',
    rIn: RINGS.C9,
    rOut: RINGS.C11,
    drawIn: RINGS.scaleIn,
    drawOut: RINGS.scaleOut,
    count: 360,
    startDeg: -90 - 0.5,
    degrees: true,
    note: '360 vạch, vạch dài hơn mỗi 5° và 10°. Dải sáng nhất trên mặt đĩa.',
  },
  {
    id: 'terms',
    layer: 'L1b',
    title: 'Hai mươi bốn tiết khí',
    rIn: RINGS.C11,
    rOut: RINGS.C13a,
    drawIn: RINGS.termIn,
    drawOut: RINGS.termOut,
    count: 24,
    startDeg: -90 - cell(24) / 2,
    fontKey: 'term',
    letterSpacing: 0.06,
    alpha: 0.95,
    labels: [
      ['立春', 'Lập xuân'], ['雨水', 'Vũ thủy'], ['驚蟄', 'Kinh trập'], ['春分', 'Xuân phân'],
      ['清明', 'Thanh minh'], ['穀雨', 'Cốc vũ'], ['立夏', 'Lập hạ'], ['小滿', 'Tiểu mãn'],
      ['芒種', 'Mang chủng'], ['夏至', 'Hạ chí'], ['小暑', 'Tiểu thử'], ['大暑', 'Đại thử'],
      ['立秋', 'Lập thu'], ['處暑', 'Xử thử'], ['白露', 'Bạch lộ'], ['秋分', 'Thu phân'],
      ['寒露', 'Hàn lộ'], ['霜降', 'Sương giáng'], ['立冬', 'Lập đông'], ['小雪', 'Tiểu tuyết'],
      ['大雪', 'Đại tuyết'], ['冬至', 'Đông chí'], ['小寒', 'Tiểu hàn'], ['大寒', 'Đại hàn'],
    ],
    note: 'Mỗi tiết khí ứng với 15° kinh độ hoàng đạo của Mặt Trời.',
  },
  {
    id: 'sigils',
    layer: 'L1a',
    title: 'Thiên can',
    rIn: RINGS.C13a,
    rOut: RINGS.C14,
    drawIn: RINGS.sigilBand,
    drawOut: RINGS.sigilBand,
    count: 12,
    startDeg: -90 - cell(12) / 2,
    fontKey: 'sigil',
    alpha: 0.8,
    labels: [
      ['甲', 'Giáp'], ['乙', 'Ất'], ['丙', 'Bính'], ['丁', 'Đinh'],
      ['戊', 'Mậu'], ['己', 'Kỷ'], ['庚', 'Canh'], ['辛', 'Tân'],
      ['壬', 'Nhâm'], ['癸', 'Quý'], ['〇', 'Không'], ['干', 'Can'],
    ],
    note: 'Dải ký hiệu thưa, nổi bật ở bốn hướng chính.',
  },
  {
    id: 'lodges',
    layer: 'L1a',
    title: 'Nhị thập bát tú',
    rIn: RINGS.C14,
    rOut: LAYER_BY_ID.L1a.outer,
    drawIn: RINGS.lodgeIn,
    drawOut: RINGS.lodgeOut,
    count: 28,
    startDeg: -90,
    fontKey: 'lodge',
    alpha: 0.9,
    labels: [
      ['角', 'Giác · Thanh Long (Đông)'], ['亢', 'Cang · Thanh Long'], ['氐', 'Đê · Thanh Long'],
      ['房', 'Phòng · Thanh Long'], ['心', 'Tâm · Thanh Long'], ['尾', 'Vĩ · Thanh Long'],
      ['箕', 'Cơ · Thanh Long'],
      ['斗', 'Đẩu · Huyền Vũ (Bắc)'], ['牛', 'Ngưu · Huyền Vũ'], ['女', 'Nữ · Huyền Vũ'],
      ['虛', 'Hư · Huyền Vũ'], ['危', 'Nguy · Huyền Vũ'], ['室', 'Thất · Huyền Vũ'],
      ['壁', 'Bích · Huyền Vũ'],
      ['奎', 'Khuê · Bạch Hổ (Tây)'], ['婁', 'Lâu · Bạch Hổ'], ['胃', 'Vị · Bạch Hổ'],
      ['昴', 'Mão · Bạch Hổ'], ['畢', 'Tất · Bạch Hổ'], ['觜', 'Chủy · Bạch Hổ'],
      ['參', 'Sâm · Bạch Hổ'],
      ['井', 'Tỉnh · Chu Tước (Nam)'], ['鬼', 'Quỷ · Chu Tước'], ['柳', 'Liễu · Chu Tước'],
      ['星', 'Tinh · Chu Tước'], ['張', 'Trương · Chu Tước'], ['翼', 'Dực · Chu Tước'],
      ['軫', 'Chẩn · Chu Tước'],
    ],
    note: 'Hai mươi tám chòm sao dọc hoàng đạo, chia làm bốn cung mỗi cung bảy tú. Mặt Trăng đi qua khoảng một tú mỗi ngày.',
  },
  {
    id: 'constellations',
    layer: 'L0',
    title: 'Hình chòm sao',
    rIn: LAYERS[0].inner,
    rOut: 1.03,
    drawIn: RINGS.constIn,
    drawOut: RINGS.constOut,
    count: 28,
    startDeg: -90,
    note: 'Hình sao của tú tương ứng, hướng theo phương bán kính.',
    labelsFrom: 'lodges',
  },
];

export const BAND_BY_ID = Object.fromEntries(BANDS.map((b) => [b.id, b]));

/** Goc canvas (radian) cua TAM o thu i */
export function cellCenterAngle(band, i) {
  const step = 360 / band.count;
  return (band.startDeg + (i + 0.5) * step) * (Math.PI / 180);
}

/** Goc canvas (radian) cua canh truoc o thu i */
export function cellStartAngle(band, i) {
  return (band.startDeg + i * (360 / band.count)) * (Math.PI / 180);
}

/** Tim o tu goc canvas theta (radian) */
export function cellIndexAt(band, theta) {
  if (!band.count) return -1;
  const deg = (theta * 180) / Math.PI;
  const rel = (((deg - band.startDeg) % 360) + 360) % 360;
  return Math.floor(rel / (360 / band.count)) % band.count;
}

/**
 * Tim dai chua ban kinh r. Truyen layerId thi chi tim trong cac dai cua vanh
 * do: khi cac vanh nghieng khac nhau, ban kinh tinh tren mat phang cua vanh A
 * co the roi vao dai cua vanh B, va o sang se bi gan nham sang vanh A.
 */
export function bandAt(r, layerId) {
  for (const b of BANDS) {
    if (layerId && b.layer !== layerId) continue;
    if (r >= b.rIn && r < b.rOut) return b;
  }
  return null;
}

/** Nhan hien thi cua mot o */
export function cellLabel(band, i) {
  const src = band.labelsFrom ? BAND_BY_ID[band.labelsFrom] : band;
  if (band.degrees) return [`${i}°`, `vạch độ thứ ${i}`];
  if (!src || !src.labels) return null;
  return src.labels[i % src.labels.length];
}
