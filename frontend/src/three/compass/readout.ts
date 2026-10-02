/** Số liệu lịch của la bàn — thuần tính toán, KHÔNG import three.js.
 *
 *  Tách khỏi index.ts để trang chủ đọc được lịch (thẻ "Lịch thiên văn") mà
 *  không kéo theo cả cảnh 3D: index.ts giờ được nạp lười, nên three.js
 *  (~150 kB sau nén) không còn nằm trong gói chính mà mọi trang phải tải,
 *  kể cả người vào thẳng /chat. */
import { calendarFor } from "./astro/calendar.js";
import { BAND_BY_ID, cellLabel } from "./bands.js";

/** Số liệu lịch để trang chủ in thành chữ. Mỗi mục là cặp [chữ Hán, tiếng
 *  Việt] đúng như nhãn vẽ trên vành, để dòng đọc số và mặt đĩa luôn khớp nhau. */
export interface CompassReadout {
  date: Date;
  /** kinh độ hoàng đạo của Mặt Trời, độ */
  sunLon: number;
  term: [string, string];
  month: [string, string];
  /** tú Mặt Trăng đang ở; phần "· Huyền Vũ" đã tách ra `lodgeQuadrant` */
  lodge: [string, string];
  lodgeQuadrant: string;
  phaseName: string;
  /** tỉ lệ diện tích sáng, 0…1 */
  illumination: number;
  /** tuổi trăng, ngày kể từ sóc */
  moonAge: number;
}

/** `cellLabel` trả về ["牛", "Ngưu · Huyền Vũ"] — tách tên tú khỏi tên cung. */
function splitLabel(raw: [string, string] | null): { pair: [string, string]; rest: string } {
  const [han, vi] = raw ?? ["", ""];
  const [name, ...rest] = vi.split(" · ");
  return { pair: [han, name], rest: rest.join(" · ") };
}

export function toReadout(cal: ReturnType<typeof calendarFor>): CompassReadout {
  const lodge = splitLabel(cellLabel(BAND_BY_ID.lodges, cal.lodgeIndex));
  return {
    date: cal.date,
    sunLon: cal.sunLon,
    term: splitLabel(cellLabel(BAND_BY_ID.terms, cal.termIndex)).pair,
    month: splitLabel(cellLabel(BAND_BY_ID.months, cal.monthIndex)).pair,
    lodge: lodge.pair,
    lodgeQuadrant: lodge.rest,
    phaseName: cal.phaseName,
    illumination: cal.phase.illumination,
    moonAge: cal.phase.age,
  };
}

/** Số liệu lịch cho một thời điểm — thuần tính toán, KHÔNG cần WebGL. Trang
 *  chủ gọi thẳng hàm này cho thẻ lịch, thay vì chờ `onCalendar`: nhờ vậy thẻ
 *  có dữ liệu ngay lúc dựng trang (cảnh 3D phải nạp font và nướng texture mất
 *  một hai giây, thẻ hiện muộn là đẩy lệch cả bố cục), và vẫn có dữ liệu trên
 *  máy không dựng được cảnh 3D. Cùng nguồn nhãn với mặt đĩa nên luôn khớp. */
export function readCalendar(date: Date = new Date()): CompassReadout {
  return toReadout(calendarFor(date));
}
