import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { Button } from "../Button";
import { Checkbox } from "../Checkbox";
import { IconButton } from "../IconButton";
import { Input } from "../Input";
import { MenuItem } from "../MenuItem";
import { Radio } from "../Radio";
import { Select } from "../Select";
import { Textarea } from "../Textarea";

/**
 * `ref` is a plain prop as of React 19, so `forwardRef` is a wrapper these
 * components no longer need. Dropping it is invisible to callers — `<Input
 * ref={…} />` is unchanged — which is exactly why it needs pinning: nothing in
 * the type system distinguishes "the ref reaches the host element" from "the
 * prop is silently dropped", and refs here are load-bearing rather than
 * decorative. The form controls are focused by the eager-after-error validation
 * pass, and the button variants anchor popovers.
 */
describe("ref reaches the host element", () => {
  it("Button forwards to the <button>", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Save</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("IconButton forwards to the <button>", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<IconButton ref={ref} aria-label="Close" icon={<span />} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("MenuItem forwards to the <button>", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<MenuItem ref={ref}>Duplicate</MenuItem>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("Input forwards to the <input>", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("Checkbox forwards to the <input>", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("Radio forwards to the <input>", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Radio ref={ref} name="g" value="a" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("Select forwards to the <select>", () => {
    const ref = createRef<HTMLSelectElement>();
    render(<Select ref={ref}><option value="a">A</option></Select>);
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });

  it("Textarea forwards to the <textarea>", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });
});

/**
 * The refs above are what the eager-after-error validation pass uses to focus
 * the first invalid field, so `.focus()` reaching the real control is the
 * behavior that actually matters, not just the identity of the node.
 */
describe("focus() through the ref", () => {
  it("focuses an Input", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it("focuses a Textarea", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} />);
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });

  it("focuses a Select", () => {
    const ref = createRef<HTMLSelectElement>();
    render(<Select ref={ref}><option value="a">A</option></Select>);
    ref.current?.focus();
    expect(document.activeElement).toBe(ref.current);
  });
});
