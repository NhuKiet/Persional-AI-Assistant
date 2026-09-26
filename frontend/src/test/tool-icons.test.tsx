import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolIcon } from "../components/ToolIcon";
import { TOOLS } from "../config/tools";

// ToolIcon trả về null cho id không có hình, và dock vẫn vẽ nút đó — thành
// một ô kính trống chỉ có nhãn chữ. Đã xảy ra thật với "hmer" (Công thức):
// tool được thêm vào TOOLS nhưng quên thêm hình vào PATHS.
describe("ToolIcon", () => {
  it.each(TOOLS.map(t => [t.id]))("có hình cho tool %s", (id) => {
    const { container } = render(<ToolIcon tool={id} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("path, circle, rect").length).toBeGreaterThan(0);
  });
});
