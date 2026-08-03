// @vitest-environment happy-dom
import React, { useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Popover } from "@core/shared-ui";

afterEach(cleanup);

/** Anchor + Popover harness — a Popover always needs a real trigger element to position against. */
function Harness({
  open,
  onClose,
  align,
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={anchorRef} type="button">
        trigger
      </button>
      <Popover open={open} onClose={onClose} anchorRef={anchorRef} align={align}>
        <button type="button">inside</button>
      </Popover>
    </div>
  );
}

describe("Popover", () => {
  it("renders children when open", () => {
    render(<Harness open onClose={() => {}} />);
    expect(screen.getByText("inside")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    render(<Harness open={false} onClose={() => {}} />);
    expect(screen.queryByText("inside")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on click outside the panel", () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on click inside the panel", () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.mouseDown(screen.getByText("inside"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT lock body scroll while open (unlike Modal/Drawer)", () => {
    const before = document.body.style.overflow;
    const { unmount } = render(<Harness open onClose={() => {}} />);
    expect(document.body.style.overflow).toBe(before);
    unmount();
    expect(document.body.style.overflow).toBe(before);
  });

  it("has a focusable, non-modal dialog role for the panel", () => {
    render(<Harness open onClose={() => {}} />);
    const panel = screen.getByRole("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("false");
    expect(panel.getAttribute("tabindex")).toBe("-1");
  });

  it("moves focus into the panel on open", () => {
    render(<Harness open onClose={() => {}} />);
    const panel = screen.getByRole("dialog");
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the anchor on close", () => {
    const { rerender } = render(<Harness open onClose={() => {}} />);
    expect(document.activeElement?.textContent).not.toBe("trigger");
    rerender(<Harness open={false} onClose={() => {}} />);
    expect(document.activeElement?.textContent).toBe("trigger");
  });
});

/**
 * The panel must never take part in normal flow, not even for one layout pass.
 *
 * A Popover is rendered as a sibling of its trigger, which in practice means
 * inside the trigger's flex row. A first render without `position` therefore
 * widens that row by the panel's width and pushes the trigger sideways — and
 * the positioning effect, running after that reflow, measures the anchor where
 * it was pushed to. The result was a panel pinned hundreds of pixels from the
 * control that opened it, on the FIRST open only: by the second, the style
 * already carried `position: fixed` and nothing was displaced.
 *
 * Asserting on the server-rendered markup is what makes this a real regression
 * test — it is the only view of the panel before any effect has run. In the
 * browser both the old and new code end up `fixed`; only the first frame differs.
 */
describe("Popover first-paint positioning", () => {
  it("is out of flow in its very first render, before any effect runs", () => {
    const html = renderToStaticMarkup(<Harness open={true} onClose={() => {}} />);
    const panel = html.slice(html.indexOf('role="dialog"'));
    expect(panel).toMatch(/position:\s*fixed/);
    // Hidden as well, so being fixed at the origin cannot flash in the corner.
    expect(panel).toMatch(/visibility:\s*hidden/);
  });
});
