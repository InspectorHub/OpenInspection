import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";

afterEach(cleanup);

const OPTS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

describe("SegmentedControl", () => {
  it("renders every option label", () => {
    render(<SegmentedControl options={OPTS} value="a" onChange={() => {}} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Bravo")).toBeTruthy();
    expect(screen.getByText("Charlie")).toBeTruthy();
  });

  it("reflects the active option via aria-checked and a distinct active class", () => {
    render(<SegmentedControl options={OPTS} value="b" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    const [a, b, c] = radios;
    // aria-checked reflects value
    expect(a.getAttribute("aria-checked")).toBe("false");
    expect(b.getAttribute("aria-checked")).toBe("true");
    expect(c.getAttribute("aria-checked")).toBe("false");
    // Canonical active-state token present on active, absent on inactive.
    expect(b.className).toContain("bg-ih-bg-card");
    expect(b.className).toContain("text-ih-primary");
    expect(b.className).toContain("shadow-ih-card");
    expect(a.className).not.toContain("bg-ih-bg-card");
    expect(c.className).not.toContain("bg-ih-bg-card");
  });

  it("calls onChange with the option value on click", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTS} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByText("Charlie"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("moves selection with arrow keys (radiogroup keyboard model)", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={OPTS} value="a" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    // ArrowRight from the first (active) segment selects the next.
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("b");
    // ArrowLeft wraps from the first back to the last.
    fireEvent.keyDown(radios[0], { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("uses a roving tabindex: only the active segment is tab-focusable", () => {
    render(<SegmentedControl options={OPTS} value="b" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0].getAttribute("tabindex")).toBe("-1");
    expect(radios[1].getAttribute("tabindex")).toBe("0");
    expect(radios[2].getAttribute("tabindex")).toBe("-1");
  });

  it("renders an icon slot when provided", () => {
    const opts = [
      { value: "grid", label: "Grid", icon: <svg data-testid="grid-icon" /> },
      { value: "list", label: "List" },
    ];
    render(<SegmentedControl options={opts} value="grid" onChange={() => {}} />);
    expect(screen.getByTestId("grid-icon")).toBeTruthy();
  });

  it("exposes radiogroup semantics with an accessible label", () => {
    render(
      <SegmentedControl options={OPTS} value="a" onChange={() => {}} ariaLabel="View mode" />,
    );
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("aria-label")).toBe("View mode");
  });

  it("passes className through to the track container", () => {
    render(
      <SegmentedControl options={OPTS} value="a" onChange={() => {}} className="custom-track" />,
    );
    expect(screen.getByRole("radiogroup").className).toContain("custom-track");
  });
});
