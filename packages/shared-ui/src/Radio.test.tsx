import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { Radio, RadioGroup } from "@core/shared-ui";

afterEach(cleanup);

const OPTS = [
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large", disabled: true },
];

describe("RadioGroup", () => {
  it("renders a legend when provided", () => {
    render(<RadioGroup name="size" value="s" onChange={() => {}} options={OPTS} legend="Size" />);
    expect(screen.getByText("Size")).toBeTruthy();
  });

  it("renders one radio per option, all sharing the group name", () => {
    render(<RadioGroup name="size" value="s" onChange={() => {}} options={OPTS} />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios.every((r) => r.name === "size")).toBe(true);
  });

  it("checks the radio matching value", () => {
    render(<RadioGroup name="size" value="m" onChange={() => {}} options={OPTS} />);
    expect((screen.getByLabelText("Medium") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Small") as HTMLInputElement).checked).toBe(false);
  });

  it("fires onChange with the selected option value", () => {
    const onChange = vi.fn();
    render(<RadioGroup name="size" value="s" onChange={onChange} options={OPTS} />);
    fireEvent.click(screen.getByLabelText("Medium"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("m");
  });

  it("marks disabled options as disabled", () => {
    render(<RadioGroup name="size" value="s" onChange={() => {}} options={OPTS} />);
    expect((screen.getByLabelText("Large") as HTMLInputElement).disabled).toBe(true);
  });

  it("exposes a radiogroup grouping for accessibility", () => {
    render(<RadioGroup name="size" value="s" onChange={() => {}} options={OPTS} legend="Size" />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });

  it("renders an error message", () => {
    render(
      <RadioGroup name="size" value="s" onChange={() => {}} options={OPTS} error="Choose a size" />,
    );
    expect(screen.getByText("Choose a size")).toBeTruthy();
  });
});

describe("Radio", () => {
  it("renders an individual radio with an associated label", () => {
    render(<Radio name="x" value="1" label="One" checked onChange={() => {}} />);
    const r = screen.getByLabelText("One") as HTMLInputElement;
    expect(r.type).toBe("radio");
    expect(r.checked).toBe(true);
  });

  it("uses the DS accent token for check styling", () => {
    render(<Radio name="x" value="1" label="One" onChange={() => {}} />);
    expect(screen.getByRole("radio").className).toContain("accent-ih-primary");
  });
});
