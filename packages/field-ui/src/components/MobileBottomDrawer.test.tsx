// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { MobileBottomDrawer } from "./MobileBottomDrawer";

afterEach(cleanup);

const sheet = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="dialog"]')!;

describe("MobileBottomDrawer", () => {
  it("keeps the parked sheet out of the tab order and the accessibility tree while closed", () => {
    const { container } = render(
      <MobileBottomDrawer open={false} onClose={vi.fn()} title="Jump to">
        <button type="button">Item</button>
      </MobileBottomDrawer>,
    );
    expect(sheet(container).hasAttribute("inert")).toBe(true);
    expect(sheet(container).getAttribute("aria-hidden")).toBe("true");
  });

  it("sizes the sheet in vh with a dvh cap, so the address bar cannot push it off screen and an old browser still gets a height", () => {
    const { container } = render(
      <MobileBottomDrawer open onClose={vi.fn()} title="Jump to" heightFraction={0.7}>
        <button type="button">Item</button>
      </MobileBottomDrawer>,
    );
    const style = sheet(container).getAttribute("style") ?? "";
    expect(style).toContain("height: 70vh");
    expect(style).toContain("max-height: 70dvh");
  });

  it("is reachable while open", () => {
    const { container } = render(
      <MobileBottomDrawer open onClose={vi.fn()} title="Jump to">
        <button type="button">Item</button>
      </MobileBottomDrawer>,
    );
    expect(sheet(container).hasAttribute("inert")).toBe(false);
    expect(sheet(container).hasAttribute("aria-hidden")).toBe(false);
  });

  it("becomes inert again after closing", () => {
    const { container, rerender } = render(
      <MobileBottomDrawer open onClose={vi.fn()} title="Jump to"><span>x</span></MobileBottomDrawer>,
    );
    rerender(<MobileBottomDrawer open={false} onClose={vi.fn()} title="Jump to"><span>x</span></MobileBottomDrawer>);
    expect(sheet(container).hasAttribute("inert")).toBe(true);
  });

  it("moves focus into the open sheet, wraps Tab inside it, and returns focus to the opener on close", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="opener" onClick={() => setOpen(true)}>open</button>
          <MobileBottomDrawer open={open} onClose={() => setOpen(false)} title="Jump to">
            <button type="button">first</button>
            <button type="button">last</button>
          </MobileBottomDrawer>
        </>
      );
    }
    const { container } = render(<Harness />);
    const opener = screen.getByTestId("opener");
    opener.focus();
    fireEvent.click(opener);
    await act(async () => { await Promise.resolve(); });
    // The sheet's own Close is its first control (the way out is the first thing a keyboard or screen reader reaches).
    const first = screen.getByRole("button", { name: "Close" });
    const last = screen.getByText("last");
    expect(sheet(container).contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(first);
    last.focus();
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => { await Promise.resolve(); });
    expect(sheet(container).hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(document.activeElement).toBe(opener);
  });
});

describe("MobileBottomDrawer exit", () => {
  it("has a worded Close of at least 44px that closes the sheet, whatever the title", () => {
    const onClose = vi.fn();
    render(
      <MobileBottomDrawer open onClose={onClose}>
        <p>body</p>
      </MobileBottomDrawer>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("min-h-11");
    expect(close.className).toContain("min-w-11");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
