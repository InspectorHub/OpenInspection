import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Checkbox } from "@core/shared-ui";

afterEach(cleanup);

describe("Checkbox", () => {
  it("renders a label associated with the checkbox in labeled (default) mode", () => {
    render(<Checkbox label="Accept terms" checked onChange={() => {}} />);
    // Label association: getByLabelText resolves the input via its label text.
    const box = screen.getByLabelText("Accept terms") as HTMLInputElement;
    expect(box.type).toBe("checkbox");
  });

  it("reflects the checked prop", () => {
    render(<Checkbox label="On" checked onChange={() => {}} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("fires onChange when toggled", () => {
    const onChange = vi.fn();
    render(<Checkbox label="Toggle" defaultChecked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.checked).toBe(true);
  });

  it("uses the DS accent token for check styling", () => {
    render(<Checkbox label="X" checked onChange={() => {}} />);
    expect(screen.getByRole("checkbox").className).toContain("accent-ih-primary");
  });

  it("renders an error message in labeled mode", () => {
    render(<Checkbox label="X" checked={false} onChange={() => {}} error="Must accept" />);
    expect(screen.getByText("Must accept")).toBeTruthy();
  });

  it("in bare mode renders only the input (no label/error chrome)", () => {
    render(
      <Checkbox bare label="Hidden" checked={false} onChange={() => {}} error="Must accept" />,
    );
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.queryByText("Must accept")).toBeNull();
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it("passes className through to the input element", () => {
    render(<Checkbox bare checked={false} onChange={() => {}} className="custom-cls" />);
    expect(screen.getByRole("checkbox").className).toContain("custom-cls");
  });
});
