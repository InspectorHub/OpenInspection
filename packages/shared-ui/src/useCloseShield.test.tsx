// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { Modal } from "./Modal";
import { Drawer } from "./Drawer";
import { CLOSE_SHIELD_MS } from "./useCloseShield";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const shield = (c: HTMLElement) => c.querySelector("[data-click-shield]");

describe.each([
  ["Modal", (open: boolean) => <Modal open={open} onClose={() => {}} title="t"><p>x</p></Modal>],
  ["Drawer", (open: boolean) => <Drawer open={open} onClose={() => {}} title="t"><p>x</p></Drawer>],
])("%s click shield", (_name, ui) => {
  it("is absent while open, present the moment it closes, gone after the window", () => {
    const { container, rerender } = render(ui(true));
    expect(shield(container)).toBeNull();
    rerender(ui(false));
    expect(shield(container)).not.toBeNull();
    expect(shield(container)!.getAttribute("aria-hidden")).toBe("true");
    act(() => { vi.advanceTimersByTime(CLOSE_SHIELD_MS - 20); });
    expect(shield(container)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(40); });
    expect(shield(container)).toBeNull();
  });

  it("CONTROL - a dialog that was never open leaves no shield", () => {
    const { container } = render(ui(false));
    expect(shield(container)).toBeNull();
  });

  it("is dropped when the dialog reopens inside the window", () => {
    const { container, rerender } = render(ui(true));
    rerender(ui(false));
    expect(shield(container)).not.toBeNull();
    rerender(ui(true));
    expect(shield(container)).toBeNull();
    expect(container.querySelector("[role=dialog]")).not.toBeNull();
  });
});
