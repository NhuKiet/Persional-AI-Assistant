import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GLASS_PRESETS } from "./newsGlassSettings";
import { GlassControlPanel } from "./GlassControlPanel";

describe("GlassControlPanel", () => {
  it("renders two Light editors and five named range controls", () => {
    render(
      <GlassControlPanel
        activePreset="tuned"
        settings={GLASS_PRESETS.tuned}
        onPresetChange={vi.fn()}
        onSettingChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("spinbutton", { name: "Góc sáng" })).toHaveValue(111);
    expect(screen.getByRole("spinbutton", { name: "Cường độ sáng" })).toHaveValue(50);
    for (const name of ["Refraction", "Depth", "Dispersion", "Frost", "Splay"]) {
      expect(screen.getByRole("slider", { name })).toBeInTheDocument();
    }
  });

  it("reports preset and clamped setting changes", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    const onSettingChange = vi.fn();
    render(
      <GlassControlPanel
        activePreset="tuned"
        settings={GLASS_PRESETS.tuned}
        onPresetChange={onPresetChange}
        onSettingChange={onSettingChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nguyên bản" }));
    expect(onPresetChange).toHaveBeenCalledWith("original");

    fireEvent.change(screen.getByRole("spinbutton", { name: "Góc sáng" }), {
      target: { value: "999" },
    });
    expect(onSettingChange).toHaveBeenCalledWith("lightAngle", 360);

    fireEvent.change(screen.getByRole("slider", { name: "Dispersion" }), {
      target: { value: "86" },
    });
    expect(onSettingChange).toHaveBeenCalledWith("dispersion", 86);
  });
});
