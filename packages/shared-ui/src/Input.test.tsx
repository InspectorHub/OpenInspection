// @vitest-environment happy-dom
/**
 * <Input> — the two behaviours the auth pages depend on, and which are the
 * reason those pages could stop hand-rolling their own field markup.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Input } from "./Input";

afterEach(cleanup);

describe("Input", () => {
  it("reserves the error line so a blur-time message cannot shove the next control", () => {
    // The defect this prevents: the message appears between the input and the
    // link under it, the link moves mid-click, and the click lands where the
    // link used to be. So the slot has to hold its height while EMPTY.
    const { container } = render(<Input label="Email" reserveErrorSpace />);
    const slot = container.querySelector("[aria-live]");
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

  it("a reserved slot is as tall as the hint, so an error cannot move the controls below", () => {
    // The hint wraps to two lines in a narrow card and the error is one line; showing one
    // replaces the other in the same grid cell, so the slot keeps the taller height.
    const { container, rerender } = render(<Input label="Password" hint="At least 8 characters" reserveErrorSpace />);
    const [hintEl, errEl] = Array.from(container.querySelectorAll("[aria-live] p"));
    expect(hintEl.textContent).toBe("At least 8 characters");
    expect(hintEl.className).not.toContain("invisible");
    expect(errEl.className).toContain("invisible");
    rerender(<Input label="Password" hint="At least 8 characters" error="Too short" reserveErrorSpace />);
    const [hint2, err2] = Array.from(container.querySelectorAll("[aria-live] p"));
    expect(hint2.className).toContain("invisible");
    expect(err2.className).not.toContain("invisible");
    expect(err2.textContent).toBe("Too short");
    expect(hint2.className).toContain("row-start-1");
    expect(err2.className).toContain("row-start-1");
  });
});
