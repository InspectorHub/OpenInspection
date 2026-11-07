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

describe("Input keyboard defaults", () => {
  const attrs = (el: Element | null) => ({
    inputmode: el?.getAttribute("inputmode") ?? null,
    capitalize: el?.getAttribute("autocapitalize") ?? null,
    correct: el?.getAttribute("autocorrect") ?? null,
    spell: el?.getAttribute("spellcheck") ?? null,
    enter: el?.getAttribute("enterkeyhint") ?? null,
  });

  it("email: email keypad, no capitalisation, correction or spellcheck", () => {
    const { container } = render(<Input type="email" />);
    expect(attrs(container.querySelector("input"))).toMatchObject({
      inputmode: "email", capitalize: "none", correct: "off", spell: "false",
    });
  });

  it("tel and url pick their own keypads", () => {
    expect(attrs(render(<Input type="tel" />).container.querySelector("input")).inputmode).toBe("tel");
    expect(attrs(render(<Input type="url" />).container.querySelector("input")).inputmode).toBe("url");
  });

  it("search gets a Search key", () => {
    const { container } = render(<Input type="search" />);
    expect(attrs(container.querySelector("input")).enter).toBe("search");
  });

  it("number: numeric for whole numbers, decimal for fractional steps, nothing when negatives are allowed", () => {
    expect(attrs(render(<Input type="number" />).container.querySelector("input")).inputmode).toBe("numeric");
    expect(attrs(render(<Input type="number" step="0.01" />).container.querySelector("input")).inputmode).toBe("decimal");
    expect(attrs(render(<Input type="number" step="any" />).container.querySelector("input")).inputmode).toBe("decimal");
    expect(attrs(render(<Input type="number" min={-5} />).container.querySelector("input")).inputmode).toBeNull();
  });

  it("plain text gets no defaults, and explicit props win", () => {
    expect(attrs(render(<Input type="text" />).container.querySelector("input")).inputmode).toBeNull();
    const { container } = render(<Input type="email" inputMode="text" />);
    expect(attrs(container.querySelector("input")).inputmode).toBe("text");
  });
});
