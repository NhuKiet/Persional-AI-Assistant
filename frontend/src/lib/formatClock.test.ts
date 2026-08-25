import { describe, expect, it } from "vitest";
import { formatClock } from "./formatClock";

describe("formatClock", () => {
  it("pads hours/minutes and labels a known Monday (2024-01-01)", () => {
    const date = new Date(2024, 0, 1, 9, 5);
    expect(formatClock(date)).toEqual({ time: "09:05", dateLabel: "Thứ Hai, 01/01" });
  });

  it("labels the day before as Sunday (2023-12-31) and pads midnight-adjacent minutes", () => {
    const date = new Date(2023, 11, 31, 23, 59);
    expect(formatClock(date)).toEqual({ time: "23:59", dateLabel: "Chủ Nhật, 31/12" });
  });

  it("pads single-digit hour and minute", () => {
    const date = new Date(2024, 0, 3, 5, 3);
    expect(formatClock(date)).toEqual({ time: "05:03", dateLabel: "Thứ Tư, 03/01" });
  });
});
