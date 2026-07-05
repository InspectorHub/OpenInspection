import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Textarea } from "@core/shared-ui";

afterEach(cleanup);

describe("Textarea", () => {
  it("renders a label in labeled (default) mode", () => {
    render(<Textarea label="Notes" />);
    expect(screen.getByText("Notes")).toBeTruthy();
  });

  it("carries the .ih-input class for metric consistency with Input", () => {
    render(<Textarea label="Notes" />);
    expect(screen.getByRole("textbox").className).toContain("ih-input");
  });

  it("applies the rows attribute", () => {
    render(<Textarea label="Notes" rows={6} />);
    expect(Number((screen.getByRole("textbox") as HTMLTextAreaElement).rows)).toBe(6);
  });

  it("reflects the value prop", () => {
    render(<Textarea label="Notes" value="hello" onChange={() => {}} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("hello");
  });

  it("fires onChange with the new value", () => {
    const onChange = vi.fn();
    render(<Textarea label="Notes" defaultValue="hello" onChange={onChange} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "world" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe("world");
  });

  it("renders an error message in labeled mode", () => {
    render(<Textarea label="Notes" error="Required" />);
    expect(screen.getByText("Required")).toBeTruthy();
  });

  it("renders a hint when there is no error", () => {
    render(<Textarea label="Notes" hint="Optional context" />);
    expect(screen.getByText("Optional context")).toBeTruthy();
  });

  it("in bare mode renders only the control (no label/error chrome)", () => {
    render(<Textarea bare label="Notes" error="Required" />);
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText("Required")).toBeNull();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("passes className through to the textarea element", () => {
    render(<Textarea bare className="custom-cls" />);
    expect(screen.getByRole("textbox").className).toContain("custom-cls");
  });
});
