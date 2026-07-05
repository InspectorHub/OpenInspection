import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Select } from "@core/shared-ui";

afterEach(cleanup);

const OPTS = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
  { value: "c", label: "Cherry", disabled: true },
];

describe("Select", () => {
  it("renders a label in labeled (default) mode", () => {
    render(<Select label="Fruit" options={OPTS} />);
    expect(screen.getByText("Fruit")).toBeTruthy();
  });

  it("renders options from the options prop", () => {
    render(<Select label="Fruit" options={OPTS} />);
    expect(screen.getByRole("option", { name: "Apple" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Banana" })).toBeTruthy();
    expect(
      (screen.getByRole("option", { name: "Cherry" }) as HTMLOptionElement).disabled,
    ).toBe(true);
  });

  it("renders native option children when no options prop is given", () => {
    render(
      <Select label="Fruit">
        <option value="x">Xigua</option>
      </Select>,
    );
    expect(screen.getByRole("option", { name: "Xigua" })).toBeTruthy();
  });

  it("carries the .ih-input class for metric consistency with Input", () => {
    render(<Select label="Fruit" options={OPTS} />);
    expect(screen.getByRole("combobox").className).toContain("ih-input");
  });

  it("reflects the value prop", () => {
    render(<Select label="Fruit" options={OPTS} value="a" onChange={() => {}} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("a");
  });

  it("fires onChange with the selected value", () => {
    const onChange = vi.fn();
    render(<Select label="Fruit" options={OPTS} defaultValue="a" onChange={onChange} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe("b");
  });

  it("supports multiple selection", () => {
    render(<Select label="Fruit" options={OPTS} multiple />);
    const select = screen.getByRole("listbox") as HTMLSelectElement;
    expect(select.multiple).toBe(true);
  });

  it("renders an error message in labeled mode", () => {
    render(<Select label="Fruit" options={OPTS} error="Pick one" />);
    expect(screen.getByText("Pick one")).toBeTruthy();
  });

  it("in bare mode renders only the control (no label/error chrome)", () => {
    render(<Select bare label="Fruit" options={OPTS} error="Pick one" />);
    expect(screen.queryByText("Fruit")).toBeNull();
    expect(screen.queryByText("Pick one")).toBeNull();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("passes className through to the select element", () => {
    render(<Select bare options={OPTS} className="custom-cls" />);
    expect(screen.getByRole("combobox").className).toContain("custom-cls");
  });
});
