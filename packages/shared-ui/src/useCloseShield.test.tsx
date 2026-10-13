// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { Modal } from "./Modal";
import { Drawer } from "./Drawer";
import { CLOSE_SHIELD_MS, CLOSE_SHIELD_MIN_OPEN_MS } from "./useCloseShield";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.useRealTimers(); });

const shields = () => document.body.querySelectorAll("[data-click-shield]");
const settle = async (ms = 0) => { await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); }); };
/** Open long enough that the close counts as a person closing it. */
const heldOpen = () => settle(CLOSE_SHIELD_MIN_OPEN_MS + 10);

const dialogs = {
  Modal: (open: boolean) => <Modal open={open} onClose={() => {}} title="t"><p>x</p></Modal>,
  Drawer: (open: boolean) => <Drawer open={open} onClose={() => {}} title="t"><p>x</p></Drawer>,
};

describe.each(Object.entries(dialogs))("%s click shield", (_name, ui) => {
  it("is absent while open, present the moment it closes, gone after the window", async () => {
    const { rerender } = render(ui(true));
    await heldOpen();
    expect(shields().length).toBe(0);
    rerender(ui(false));
    await settle();
    expect(shields().length).toBe(1);
    expect(shields()[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(shields()[0]!.className).toContain("fixed inset-0");
    await settle(CLOSE_SHIELD_MS - 20);
    expect(shields().length).toBe(1);
    await settle(40);
    expect(shields().length).toBe(0);
  });

  it("is raised when the dialog UNMOUNTS while open, the `{open && <Dialog />}` shape", async () => {
    const { unmount } = render(ui(true));
    await heldOpen();
    unmount();
    await settle();
    expect(shields().length).toBe(1);
    await settle(CLOSE_SHIELD_MS + 10);
    expect(shields().length).toBe(0);
  });

  it("CONTROL - a dialog that was never open leaves no shield", async () => {
    const { unmount } = render(ui(false));
    unmount();
    await settle();
    expect(shields().length).toBe(0);
  });

  it("CONTROL - a dialog open for less than the minimum (a remount) leaves no shield", async () => {
    const { rerender } = render(ui(true));
    await settle(CLOSE_SHIELD_MIN_OPEN_MS - 50);
    rerender(ui(false));
    await settle();
    expect(shields().length).toBe(0);
  });

  it("is dropped when a dialog opens inside the window", async () => {
    const { rerender } = render(ui(true));
    await heldOpen();
    rerender(ui(false));
    await settle();
    expect(shields().length).toBe(1);
    rerender(ui(true));
    await settle();
    expect(shields().length).toBe(0);
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("is not raised while another dialog is still standing", async () => {
    const lower = render(ui(true));
    const upper = render(dialogs.Modal(true));
    await heldOpen();
    lower.unmount();
    await settle();
    expect(shields().length).toBe(0);
    upper.unmount();
    await settle();
    expect(shields().length).toBe(1);
  });
});
