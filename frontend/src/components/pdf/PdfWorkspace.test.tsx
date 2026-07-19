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

  it("keeps stable outline, viewer, and assistant grid slots when panels close", () => {
    const { container } = render(
      <PdfWorkspace
        mode="desktop"
        outlineOpen={false}
        assistantOpen={false}
        toolbar={null}
        outline={<div>Outline</div>}
        viewer={<div>Viewer</div>}
        assistant={<div>Assistant</div>}
        onCloseOverlays={() => {}}
      />,
    );

    const body = container.querySelector(".pdf-workspace-body");
    expect(Array.from(body?.children ?? []).map((element) => element.className)).toEqual([
      "pdf-outline-slot",
      "pdf-viewer-panel",
      "pdf-assistant-slot",
    ]);
    expect(container.querySelector(".pdf-outline-slot")).toBeEmptyDOMElement();
    expect(container.querySelector(".pdf-assistant-slot")).toBeEmptyDOMElement();
    expect(screen.getByRole("main", { name: "Trình đọc PDF" })).toHaveTextContent("Viewer");
  });

  it("does not cover a laptop workspace for the docked assistant alone", () => {
    render(
      <PdfWorkspace
        mode="laptop"
        outlineOpen={false}
        assistantOpen
        toolbar={null}
        outline={null}
        viewer={null}
        assistant={null}
        onCloseOverlays={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Đóng bảng đang mở" })).not.toBeInTheDocument();
  });

  it("renders a laptop backdrop only for the outline drawer", async () => {
    const onCloseOverlays = vi.fn();
    render(
      <PdfWorkspace
        mode="laptop"
        outlineOpen
        assistantOpen={false}
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

  it("restores the opener when a narrow backdrop closes the overlay", async () => {
    function Harness() {
      const [outlineOpen, setOutlineOpen] = useState(false);
      return (
        <PdfWorkspace
          mode="narrow"
          outlineOpen={outlineOpen}
          assistantOpen={false}
          toolbar={<button type="button" onClick={() => setOutlineOpen(true)}>Mục lục</button>}
          outline={<button type="button">Outline action</button>}
          viewer={null}
          assistant={null}
          onCloseOverlays={() => setOutlineOpen(false)}
        />
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Mục lục" });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole("button", { name: "Đóng bảng đang mở" }));

    expect(opener).toHaveFocus();
  });

  it("restores the opener after a programmatic close or breakpoint deactivation", () => {
    const props = {
      outlineOpen: true,
      assistantOpen: false,
      toolbar: <button type="button">Mục lục</button>,
      outline: <button type="button">Outline action</button>,
      viewer: null,
      assistant: null,
      onCloseOverlays: () => {},
    };
    const { rerender } = render(<PdfWorkspace {...props} mode="narrow" outlineOpen={false} />);
    const opener = screen.getByRole("button", { name: "Mục lục" });
    opener.focus();
    rerender(<PdfWorkspace {...props} mode="narrow" />);
    expect(screen.getByRole("button", { name: "Outline action" })).toHaveFocus();

    rerender(<PdfWorkspace {...props} mode="narrow" outlineOpen={false} />);
    expect(opener).toHaveFocus();

    rerender(<PdfWorkspace {...props} mode="narrow" />);
    rerender(<PdfWorkspace {...props} mode="desktop" />);
    expect(opener).toHaveFocus();
  });

  it("restores a connected external opener when the workspace unmounts", () => {
    const opener = document.createElement("button");
    opener.textContent = "External opener";
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(
      <PdfWorkspace
        mode="narrow"
        outlineOpen
        assistantOpen={false}
        toolbar={null}
        outline={<button type="button">Outline action</button>}
        viewer={null}
        assistant={null}
        onCloseOverlays={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Outline action" })).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("switches narrow overlays without restoring the stale opener", async () => {
    function Harness() {
      const [active, setActive] = useState<"outline" | "assistant" | null>(null);
      return (
        <PdfWorkspace
          mode="narrow"
          outlineOpen={active === "outline"}
          assistantOpen={active === "assistant"}
          toolbar={(
            <>
              <button type="button" onClick={() => setActive("outline")}>Mục lục</button>
              <button type="button" onClick={() => setActive("assistant")}>Hỏi tài liệu</button>
            </>
          )}
          outline={<button type="button">Outline action</button>}
          viewer={null}
          assistant={<button type="button">Assistant action</button>}
          onCloseOverlays={() => setActive(null)}
        />
      );
    }

    render(<Harness />);
    const outlineOpener = screen.getByRole("button", { name: "Mục lục" });
    const assistantOpener = screen.getByRole("button", { name: "Hỏi tài liệu" });
    await userEvent.click(outlineOpener);
    await userEvent.click(assistantOpener);
    expect(screen.getByRole("button", { name: "Assistant action" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(assistantOpener).toHaveFocus();
    expect(outlineOpener).not.toHaveFocus();
  });
});
