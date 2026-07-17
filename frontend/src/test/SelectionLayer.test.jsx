/**
 * SelectionLayer — lõi tương tác của trình đọc PDF.
 *
 * Ưu tiên khoá lại hành vi ẩn/hiện toolbar: bug thật đã gặp là toolbar nằm lại
 * sau khi người dùng bỏ bôi đen, vì nhánh "không có selection" không làm gì cả.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SelectionLayer from "../pdf/SelectionLayer";

/** Giả lập window.getSelection trả về đoạn text đang bôi đen (hoặc rỗng).
 *  `rect` là bounding box của vùng chọn — toolbar neo theo nó. */
function mockSelection(text, rect = null) {
  vi.spyOn(window, "getSelection").mockReturnValue({
    toString: () => text,
    removeAllRanges: () => {},
    rangeCount: rect ? 1 : 0,
    getRangeAt: () => ({ getBoundingClientRect: () => rect }),
  });
}

function renderLayer(onPin = vi.fn()) {
  render(
    <SelectionLayer canvases={new Map()} onPin={onPin}>
      <div className="pdf-page-wrap" data-page-number="3">
        <canvas />
      </div>
    </SelectionLayer>,
  );
  return { host: document.querySelector(".selection-host"), onPin };
}

const toolbar = () => document.querySelector(".sel-toolbar");
const cropBox = () => document.querySelector(".crop-box");

/** Kéo một khung Alt+drag từ (x1,y1) đến (x2,y2). */
function altDrag(host, target, [x1, y1], [x2, y2]) {
  fireEvent.mouseDown(target, { clientX: x1, clientY: y1, altKey: true });
  fireEvent.mouseMove(host,   { clientX: x2, clientY: y2, altKey: true });
  fireEvent.mouseUp(host,     { clientX: x2, clientY: y2, altKey: true });
}

describe("SelectionLayer — toolbar theo selection", () => {
  it("bôi đen text thì hiện toolbar", () => {
    mockSelection("một đoạn văn");
    const { host } = renderLayer();
    fireEvent.mouseUp(host, { clientX: 50, clientY: 60 });
    expect(toolbar()).toBeTruthy();
    expect(screen.getByText(/Giải thích/i)).toBeInTheDocument();
  });

  it("bỏ bôi đen thì ẩn toolbar", () => {
    mockSelection("một đoạn văn");
    const { host } = renderLayer();
    fireEvent.mouseUp(host, { clientX: 50, clientY: 60 });
    expect(toolbar()).toBeTruthy();

    // click ra chỗ khác => không còn selection
    mockSelection("");
    fireEvent.mouseUp(host, { clientX: 10, clientY: 10 });
    expect(toolbar()).toBeNull();
  });

  it("selection chỉ có khoảng trắng cũng coi như không có", () => {
    mockSelection("   \n  ");
    const { host } = renderLayer();
    fireEvent.mouseUp(host, { clientX: 50, clientY: 60 });
    expect(toolbar()).toBeNull();
  });

  it("bấm Giải thích thì phát pin text kèm số trang và đóng toolbar", () => {
    mockSelection("một đoạn văn");
    const { onPin } = renderLayer();
    // bôi đen kết thúc TRONG trang => số trang lấy từ wrapper gần nhất
    fireEvent.mouseUp(document.querySelector("canvas"), { clientX: 50, clientY: 60 });

    fireEvent.mouseDown(screen.getByText(/Giải thích/i));
    expect(onPin).toHaveBeenCalledWith(
      { type: "text", page: 3, text: "một đoạn văn" },
      "explain",
    );
    expect(toolbar()).toBeNull();
  });

  it("toolbar neo dưới vùng chọn chứ không theo con trỏ", () => {
    // host trong jsdom có rect toàn 0 => toạ độ host-relative = toạ độ viewport
    mockSelection("đoạn văn", { left: 100, right: 300, width: 200, bottom: 80, top: 60 });
    const { host } = renderLayer();
    // thả chuột ở tận (999, 999) — nếu neo theo con trỏ thì sẽ ra 999
    fireEvent.mouseUp(host, { clientX: 999, clientY: 999 });

    const tb = toolbar();
    expect(tb.style.left).toBe("200px");  // giữa vùng chọn: 100 + 200/2
    expect(tb.style.top).toBe("80px");    // cạnh dưới vùng chọn
  });
});


describe("SelectionLayer — khung crop giữ lại sau khi thả Alt", () => {
  /** canvas giả có API tối thiểu để cropCanvas chạy được trong jsdom. */
  function fakeCanvases() {
    const out = document.createElement("canvas");
    out.getContext = () => ({ drawImage: () => {} });
    out.toDataURL = () => "data:image/jpeg;base64,FAKE";
    const src = document.createElement("canvas");
    Object.defineProperty(src, "clientWidth", { value: 400 });
    src.width = 400; src.height = 600;
    src.getContext = () => ({ drawImage: () => {} });
    vi.spyOn(document, "createElement").mockImplementation((tag) =>
      tag === "canvas" ? out : Object.getPrototypeOf(document).createElement.call(document, tag));
    return new Map([[3, src]]);
  }

  it("thả Alt xong khung vẫn hiện và được đánh dấu là đã chốt", () => {
    mockSelection("");
    const onPin = vi.fn();
    render(
      <SelectionLayer canvases={fakeCanvases()} onPin={onPin}>
        <div className="pdf-page-wrap" data-page-number="3"><canvas /></div>
      </SelectionLayer>,
    );
    const host = document.querySelector(".selection-host");
    altDrag(host, document.querySelector(".pdf-page-wrap"), [10, 10], [150, 120]);

    expect(cropBox()).toBeTruthy();                                   // khung KHÔNG biến mất
    expect(cropBox().className).toContain("crop-box-done");           // đã chốt, khác lúc đang kéo
    expect(toolbar()).toBeTruthy();
  });

  it("đóng toolbar thì khung mới biến mất", () => {
    mockSelection("");
    render(
      <SelectionLayer canvases={fakeCanvases()} onPin={vi.fn()}>
        <div className="pdf-page-wrap" data-page-number="3"><canvas /></div>
      </SelectionLayer>,
    );
    const host = document.querySelector(".selection-host");
    altDrag(host, document.querySelector(".pdf-page-wrap"), [10, 10], [150, 120]);
    expect(cropBox()).toBeTruthy();

    fireEvent.mouseDown(document.querySelector(".sel-tb-close"));
    expect(cropBox()).toBeNull();
    expect(toolbar()).toBeNull();
  });
});
