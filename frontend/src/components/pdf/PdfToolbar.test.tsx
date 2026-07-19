import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PdfToolbar from "./PdfToolbar";

function toolbarProps() {
  return {
    filename: "doc.pdf",
    currentPage: 2,
    totalPages: 5,
    outlineOpen: true,
    assistantOpen: true,
    onNavigate: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitWidth: vi.fn(),
    onToggleSearch: vi.fn(),
    onToggleOutline: vi.fn(),
    onToggleAssistant: vi.fn(),
    onChangeFile: vi.fn(),
  };
}

describe("PdfToolbar", () => {
  it("clamps entered pages and exposes panel state", async () => {
    const props = toolbarProps();
    render(<PdfToolbar {...props} />);
    const input = screen.getByRole("spinbutton", { name: "Trang hiện tại" });

    await userEvent.clear(input);
    await userEvent.type(input, "99{Enter}");

    expect(props.onNavigate).toHaveBeenCalledWith(5);
    expect(input).toHaveValue(5);
    expect(screen.getByRole("button", { name: "Ẩn mục lục" }))
      .toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Ẩn trợ lý tài liệu" }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("restores the current page instead of navigating for empty input", async () => {
    const props = toolbarProps();
    render(<PdfToolbar {...props} />);
    const input = screen.getByRole("spinbutton", { name: "Trang hiện tại" });

    await userEvent.clear(input);
    await userEvent.type(input, "{Enter}");

    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(input).toHaveValue(2);
  });

  it("tracks external page changes", () => {
    const props = toolbarProps();
    const { rerender } = render(<PdfToolbar {...props} />);

    rerender(<PdfToolbar {...props} currentPage={4} />);

    expect(screen.getByRole("spinbutton", { name: "Trang hiện tại" })).toHaveValue(4);
    expect(screen.getByText("/ 5")).toBeInTheDocument();
  });

  it("wires every viewer, panel, search, and file action", async () => {
    const props = toolbarProps();
    render(<PdfToolbar {...props} outlineOpen={false} assistantOpen={false} />);

    await userEvent.click(screen.getByRole("button", { name: "Mở mục lục" }));
    await userEvent.click(screen.getByRole("button", { name: "Trang trước" }));
    await userEvent.click(screen.getByRole("button", { name: "Trang tiếp theo" }));
    await userEvent.click(screen.getByRole("button", { name: "Thu nhỏ" }));
    await userEvent.click(screen.getByRole("button", { name: "Phóng to" }));
    await userEvent.click(screen.getByRole("button", { name: "Vừa chiều rộng" }));
    await userEvent.click(screen.getByRole("button", { name: "Tìm trong PDF" }));
    await userEvent.click(screen.getByRole("button", { name: "Hỏi tài liệu" }));
    await userEvent.click(screen.getByRole("button", { name: "Đổi tệp" }));

    expect(props.onToggleOutline).toHaveBeenCalledOnce();
    expect(props.onPrevious).toHaveBeenCalledOnce();
    expect(props.onNext).toHaveBeenCalledOnce();
    expect(props.onZoomOut).toHaveBeenCalledOnce();
    expect(props.onZoomIn).toHaveBeenCalledOnce();
    expect(props.onFitWidth).toHaveBeenCalledOnce();
    expect(props.onToggleSearch).toHaveBeenCalledOnce();
    expect(props.onToggleAssistant).toHaveBeenCalledOnce();
    expect(props.onChangeFile).toHaveBeenCalledOnce();
  });

  it("uses non-submitting buttons for every toolbar action", () => {
    render(<PdfToolbar {...toolbarProps()} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("type", "button");
    }
  });

  it("disables page entry before PDF.js reports a page count", () => {
    render(<PdfToolbar {...toolbarProps()} currentPage={1} totalPages={0} />);

    expect(screen.getByRole("spinbutton", { name: "Trang hiện tại" })).toBeDisabled();
  });
});
