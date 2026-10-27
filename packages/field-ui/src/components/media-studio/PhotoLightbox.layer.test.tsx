// @vitest-environment happy-dom
/**
 * The photo viewer is a layer like any dialog: while it is open the host's back key (a cancelable Escape on window,
 * offered first to `escapeWillBeHandled`) closes it instead of leaving the editor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { escapeWillBeHandled, hasOpenLayer } from "@core/shared-ui";
import { PhotoLightbox } from "./PhotoLightbox";

afterEach(cleanup);

const show = (open: boolean, onClose = vi.fn()) =>
  render(<PhotoLightbox slides={[{ src: "a.jpg" }]} index={0} open={open} onClose={onClose} />);

describe("PhotoLightbox as a layer", () => {
  it("is on the layer stack while open, so the back key is claimed", () => {
    show(true);
    expect(hasOpenLayer()).toBe(true);
    expect(escapeWillBeHandled()).toBe(true);
  });

  it("an Escape on window closes it and is marked handled", () => {
    const onClose = vi.fn();
    show(true, onClose);
    const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    act(() => { window.dispatchEvent(esc); });
    expect(onClose).toHaveBeenCalled();
    expect(esc.defaultPrevented).toBe(true);
  });

  it("CONTROL - closed, it holds no layer and takes no Escape", () => {
    const onClose = vi.fn();
    show(false, onClose);
    expect(hasOpenLayer()).toBe(false);
    expect(escapeWillBeHandled()).toBe(false);
    const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    act(() => { window.dispatchEvent(esc); });
    expect(onClose).not.toHaveBeenCalled();
    expect(esc.defaultPrevented).toBe(false);
  });

  it("leaves the stack when it closes", () => {
    const { rerender } = show(true);
    expect(hasOpenLayer()).toBe(true);
    rerender(<PhotoLightbox slides={[{ src: "a.jpg" }]} index={0} open={false} onClose={vi.fn()} />);
    expect(hasOpenLayer()).toBe(false);
  });
});
