// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { SpeedModeUndoToast } from "./SpeedModeUndoToast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const pending = { message: "Rated as Monitor.", onUndo: () => {} };

describe("SpeedModeUndoToast", () => {
  it("floating placement is the original class string, exactly", () => {
    render(<SpeedModeUndoToast pending={pending} onDismiss={() => {}} />);
    expect(screen.getByText("Rated as Monitor.").parentElement!.className).toBe(
      "fixed left-1/2 -translate-x-1/2 bottom-20 z-50 px-4 py-2.5 bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover flex items-center gap-3 text-[13px]",
    );
  });

  it("inline placement is in the page flow, not fixed over anything", () => {
    render(<SpeedModeUndoToast pending={pending} onDismiss={() => {}} placement="inline" />);
    const cls = screen.getByText("Rated as Monitor.").parentElement!.className;
    expect(cls).not.toContain("fixed");
    expect(cls).not.toContain("bottom-20");
    expect(cls).toContain("mx-auto");
    expect(cls).toContain("shrink-0");
  });

  it("dismisses 3 seconds after it appeared even when the parent re-renders with a new onDismiss every time", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<SpeedModeUndoToast pending={pending} onDismiss={() => onDismiss()} />);
    for (let i = 0; i < 5; i++) {
      act(() => { vi.advanceTimersByTime(500); });
      rerender(<SpeedModeUndoToast pending={pending} onDismiss={() => onDismiss()} />);
    }
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(600); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
