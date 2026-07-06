import React, { useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
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
