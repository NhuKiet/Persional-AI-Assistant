/** `Date` → display strings for the home hero clock. Pure/local — no
 *  Intl.DateTimeFormat locale dependency, so output is deterministic across
 *  environments (CI, different OS locales, etc.). */

export interface ClockDisplay {
  time: string;
  dateLabel: string;
}

const WEEKDAYS = [
  "Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatClock(date: Date): ClockDisplay {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const dateLabel = `${WEEKDAYS[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  return { time, dateLabel };
}
