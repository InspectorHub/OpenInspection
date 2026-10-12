// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
});
