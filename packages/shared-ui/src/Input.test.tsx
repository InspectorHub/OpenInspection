// @vitest-environment happy-dom
/**
 * <Input> — the two behaviours the auth pages depend on, and which are the
 * reason those pages could stop hand-rolling their own field markup.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Input } from "./Input";

describe("Input", () => {
  it("reserves the error line so a blur-time message cannot shove the next control", () => {
    // The defect this prevents: the message appears between the input and the
    // link under it, the link moves mid-click, and the click lands where the
    // link used to be. So the slot has to hold its height while EMPTY.
    const { container } = render(<Input label="Email" reserveErrorSpace />);
    const slot = container.querySelector("p");
    expect(slot).not.toBeNull();
    expect(slot!.className).toContain("min-h-4");
    expect(slot!.textContent).toBe("");
  });

  it("does not reserve it by default — a dense form would grow a blank line per field", () => {
    const { container } = render(<Input label="Email" />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("announces the error politely rather than silently swapping the text", () => {
    const { container } = render(<Input label="Email" error="Enter an email address" />);
    const slot = container.querySelector("p")!;
    expect(slot.getAttribute("aria-live")).toBe("polite");
    expect(slot.textContent).toBe("Enter an email address");
  });

  it("ties the label to the input, so clicking the label focuses the field", () => {
    const { container } = render(<Input id="email-field" label="Email" />);
    expect(container.querySelector("label")!.getAttribute("for")).toBe("email-field");
  });

  it("keeps a field-level action (Forgot password?) on the label's row", () => {
    const { getByText, container } = render(
      <Input id="pw" label="Password" labelAction={<a href="/forgot-password">Forgot password?</a>} />,
    );
    const row = getByText("Forgot password?").parentElement!;
    expect(row.className).toContain("justify-between");
    expect(row.contains(container.querySelector("label"))).toBe(true);
  });
});
