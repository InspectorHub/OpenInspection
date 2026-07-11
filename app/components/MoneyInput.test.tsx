import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { MoneyInput } from "./MoneyInput";

describe("MoneyInput", () => {
  it("shows a whole-dollar $-formatted value when blurred", () => {
    render(<MoneyInput cents={850000} onChange={() => {}} ariaLabel="Cost" />);
    expect((screen.getByLabelText("Cost") as HTMLInputElement).value).toBe("$8,500");
  });

  it("reveals the raw editable number (no $ / commas) on focus", () => {
    render(<MoneyInput cents={850050} onChange={() => {}} ariaLabel="Cost" />);
    const input = screen.getByLabelText("Cost") as HTMLInputElement;
    expect(input.value).toBe("$8,500.50"); // blurred: cents preserved
    fireEvent.focus(input);
    expect(input.value).toBe("8500.5"); // editable: plain, comma-free
  });

  it("parses commas, a $ prefix and decimals to integer cents", () => {
    const onChange = vi.fn();
    render(<MoneyInput cents={null} onChange={onChange} ariaLabel="Cost" />);
    const input = screen.getByLabelText("Cost");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "8,500.50" } });
    expect(onChange).toHaveBeenLastCalledWith(850050);
  });

  it("does NOT reformat mid-typing — the field shows exactly what was typed while focused", () => {
    // Regression: the old input bound value to (cents/100).toFixed(2), so every
    // keystroke reformatted and the caret fought the user (typing "8500" yielded
    // a garbled "0.02"). MoneyInput keeps a raw draft while focused.
    let cents: number | null = null;
    const { rerender } = render(
      <MoneyInput cents={cents} onChange={(c) => { cents = c; }} ariaLabel="Cost" />,
    );
    const input = screen.getByLabelText("Cost") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "8500" } });
    // Parent re-renders with the new cents prop; the focused field must still
    // show the raw "8500", not a reformatted string.
    rerender(<MoneyInput cents={cents} onChange={(c) => { cents = c; }} ariaLabel="Cost" />);
    expect(input.value).toBe("8500");
    expect(cents).toBe(850000);
  });
});
