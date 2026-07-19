import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PdfWorkspace from "./PdfWorkspace";

describe("PdfWorkspace", () => {
  it("exposes document, viewer, and assistant regions", () => {
    const { container } = render(
      <PdfWorkspace
        mode="desktop"
        outlineOpen
        assistantOpen
        toolbar={<div>Toolbar</div>}
        outline={<div>Outline</div>}
        viewer={<div>Viewer</div>}
        assistant={<div>Assistant</div>}
        onCloseOverlays={() => {}}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Mục lục tài liệu" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Trình đọc PDF" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Trợ lý tài liệu" })).toBeInTheDocument();
    expect(container.querySelector(".pdf-workspace-desktop")).toBeInTheDocument();
    expect(container.querySelector(".pdf-workspace-toolbar")).toHaveTextContent("Toolbar");
  });

  it("renders an overlay backdrop outside desktop mode", async () => {
    const onCloseOverlays = vi.fn();
    render(
      <PdfWorkspace
        mode="laptop"
        outlineOpen
        assistantOpen
        toolbar={null}
        outline={null}
        viewer={null}
        assistant={null}
        onCloseOverlays={onCloseOverlays}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Đóng bảng đang mở" }));

    expect(onCloseOverlays).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Đóng bảng đang mở" }))
      .toHaveAttribute("type", "button");
  });

  it("contains narrow overlay focus and restores its opening control on Escape", async () => {
    function Harness() {
      const [assistantOpen, setAssistantOpen] = useState(false);
      return (
        <PdfWorkspace
          mode="narrow"
          outlineOpen={false}
          assistantOpen={assistantOpen}
          toolbar={(
            <button type="button" onClick={() => setAssistantOpen(true)}>
              Hỏi tài liệu
            </button>
          )}
          outline={null}
          viewer={<button type="button">Viewer action</button>}
          assistant={(
            <>
              <button type="button">First assistant action</button>
              <button type="button">Last assistant action</button>
            </>
          )}
          onCloseOverlays={() => setAssistantOpen(false)}
        />
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Hỏi tài liệu" });
    await userEvent.click(opener);
    const first = screen.getByRole("button", { name: "First assistant action" });
    const last = screen.getByRole("button", { name: "Last assistant action" });
    expect(first).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
    await userEvent.tab();
    expect(first).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Trợ lý tài liệu" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("focuses a narrow overlay even when its slot has no controls", async () => {
    const { rerender } = render(
      <PdfWorkspace
        mode="narrow"
        outlineOpen={false}
        assistantOpen={false}
        toolbar={<button type="button">Mục lục</button>}
        outline={<p>Không có mục</p>}
        viewer={null}
        assistant={null}
        onCloseOverlays={() => {}}
      />,
    );
    const opener = screen.getByRole("button", { name: "Mục lục" });
    opener.focus();

    rerender(
      <PdfWorkspace
        mode="narrow"
        outlineOpen
        assistantOpen={false}
        toolbar={<button type="button">Mục lục</button>}
        outline={<p>Không có mục</p>}
        viewer={null}
        assistant={null}
        onCloseOverlays={() => {}}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Mục lục tài liệu" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("navigation", { name: "Mục lục tài liệu" })).toHaveFocus();
  });
});
