import { useId } from "react";

/** Hình Mặt Trăng theo pha, vẽ bằng một path SVG.
 *
 *  Phần sáng = nửa đường tròn phía được chiếu + nửa elip làm đường phân sáng
 *  tối (terminator). Bán trục ngang của elip là r·|1 − 2k| với k là tỉ lệ
 *  sáng: k = 0.5 thì elip dẹt thành đoạn thẳng (bán nguyệt), k → 0 hoặc 1 thì
 *  elip phình thành cả đường tròn (sóc / vọng). Trăng khuyết (k < 0.5) có
 *  terminator cong về phía sáng, trăng lồi (k > 0.5) cong ra phía tối — nên
 *  chỉ cần lật cờ sweep của cung elip.
 *
 *  Nhìn từ Bắc bán cầu: trăng đang tròn dần sáng bên PHẢI, đang khuyết sáng
 *  bên TRÁI — nửa khuyết vẽ bằng cách lật gương nửa tròn dần. */

const R = 50;

export interface MoonPhaseProps {
  /** tỉ lệ diện tích sáng, 0…1 */
  illumination: number;
  /** true = đang tròn dần (từ sóc tới vọng) */
  waxing: boolean;
  size?: number;
}

export function MoonPhase({ illumination, waxing, size = 72 }: MoonPhaseProps) {
  // id riêng cho mỗi lần dùng: gradient/filter trong SVG inline là id toàn
  // trang, hai hình trăng cùng id thì hình sau lấy nhầm gradient của hình trước
  const uid = useId();
  const k = Math.min(1, Math.max(0, illumination));
  const rx = R * Math.abs(1 - 2 * k);
  const lit = `M${R} 0 A${R} ${R} 0 0 1 ${R} ${2 * R} A${rx} ${R} 0 0 ${k > 0.5 ? 1 : 0} ${R} 0 Z`;

  return (
    <svg className="moon-phase" width={size} height={size} viewBox="-6 -6 112 112" aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}-lit`} cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#fffbe2" />
          <stop offset="70%" stopColor="#f3e79a" />
          <stop offset="100%" stopColor="#e8d54f" />
        </radialGradient>
        <filter id={`${uid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {/* Mặt tối vẫn hiện mờ (ánh đất), để trăng khuyết mỏng vẫn đọc ra là
          một đĩa tròn chứ không phải một vệt cong trôi nổi. */}
      <circle cx={R} cy={R} r={R} fill="rgba(255, 255, 255, 0.07)" stroke="rgba(255, 255, 255, 0.16)" />
      <g transform={waxing ? undefined : `matrix(-1 0 0 1 ${2 * R} 0)`}>
        <path d={lit} fill="#f3e79a" opacity="0.55" filter={`url(#${uid}-glow)`} />
        <path d={lit} fill={`url(#${uid}-lit)`} />
      </g>
    </svg>
  );
}
