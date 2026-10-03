import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { LatexEditor } from "./LatexEditor";

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <LatexEditor value={value} original={initial} onChange={setValue} doubtful={[]} />;
}

function box() {
  return screen.getByRole("textbox", { name: "LaTeX (sửa được)" }) as HTMLTextAreaElement;
}

it("wraps the selection in set braces", async () => {
  render(<Harness initial="x \in 1 , 2" />);
  box().setSelectionRange(6, 11); // "1 , 2"

  await userEvent.click(screen.getByRole("button", { name: /Ngoặc nhọn/ }));

  expect(box().value).toBe("x \\in \\{ 1 , 2 \\}");
});

it("inserts a matrix at the cursor with its first entry selected to type over", async () => {
  render(<Harness initial="A = " />);
  box().setSelectionRange(4, 4);

  await userEvent.click(screen.getByRole("button", { name: /Ma trận 2×2 trong ngoặc tròn/ }));

  expect(box().value).toBe("A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}");
  const { selectionStart, selectionEnd, value } = box();
  expect(value.slice(selectionStart, selectionEnd)).toBe("a");
});

it("inserts a row break the model can't write itself", async () => {
  render(<Harness initial="a & b c & d" />);
  box().setSelectionRange(5, 5);

  await userEvent.click(screen.getByRole("button", { name: /Xuống dòng/ }));

  expect(box().value).toBe("a & b \\\\  c & d");
});

it("marks the box as edited, so the model's reading can be restored", async () => {
  render(<Harness initial="x" />);
  box().setSelectionRange(1, 1);

  await userEvent.click(screen.getByRole("button", { name: /Hệ phương trình/ }));

  expect(screen.getByText("Đã sửa so với bản mô hình đọc.")).toBeInTheDocument();
});
