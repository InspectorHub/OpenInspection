// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTextEntryActive } from "./useTextEntryActive";

beforeEach(() => {
  vi.useFakeTimers();
  pointer(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const pointer = (coarse: boolean): void => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: coarse && query.includes("pointer: coarse"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
};


const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function Fields() {
  return (
    <div>
      <textarea aria-label="notes" />
      <input aria-label="search" type="text" />
      <input aria-label="tick" type="checkbox" />
      <button type="button">go</button>
    </div>
  );
}

function setHeight(px: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: px });
}

describe("useTextEntryActive", () => {
  it("is false until a text field has focus, true while it does, and false once the keyboard has gone", async () => {
    setHeight(844);
    const hook = renderHook(() => useTextEntryActive());
    render(<Fields />);
    expect(hook.result.current).toBe(false);
    act(() => screen.getByLabelText("notes").focus());
    expect(hook.result.current).toBe(true);
    act(() => screen.getByLabelText("notes").blur());
    await tick(5);
    // Left, but the keyboard may still be on its way down: the bars stay out of sight.
    expect(hook.result.current).toBe(true);
    await tick(450);
    expect(hook.result.current).toBe(false);
  });

  it("lets go as soon as the window has grown back, not before (the bars must not appear mid-screen while the window is short)", async () => {
    setHeight(351);
    const hook = renderHook(() => useTextEntryActive());
    render(<Fields />);
    act(() => screen.getByLabelText("notes").focus());
    act(() => screen.getByLabelText("notes").blur());
    await tick(5);
    expect(hook.result.current).toBe(true);
    // A resize that does not make the window taller changes nothing.
    act(() => { window.dispatchEvent(new Event("resize")); });
    await tick(100);
    expect(hook.result.current).toBe(true);
    setHeight(616);
    act(() => { window.dispatchEvent(new Event("resize")); });
    await tick(100);
    expect(hook.result.current).toBe(false);
  });

  it("stays true when focus moves from one text field to another, and when a field takes focus again while settling", async () => {
    setHeight(844);
    const hook = renderHook(() => useTextEntryActive());
    render(<Fields />);
    act(() => screen.getByLabelText("notes").focus());
    act(() => screen.getByLabelText("search").focus());
    await tick(450);
    expect(hook.result.current).toBe(true);
    act(() => screen.getByLabelText("search").blur());
    await tick(100);
    act(() => screen.getByLabelText("notes").focus());
    await tick(450);
    expect(hook.result.current).toBe(true);
  });

  it("does not count a checkbox or a button, which raise no keyboard", async () => {
    setHeight(844);
    const hook = renderHook(() => useTextEntryActive());
    render(<Fields />);
    act(() => screen.getByLabelText("tick").focus());
    await tick(450);
    expect(hook.result.current).toBe(false);
    act(() => screen.getByText("go").focus());
    await tick(450);
    expect(hook.result.current).toBe(false);
  });

  it("does not stay stuck on when the focused field is removed without a blur", async () => {
    setHeight(844);
    const hook = renderHook(() => useTextEntryActive());
    const view = render(<Fields />);
    act(() => screen.getByLabelText("notes").focus());
    expect(hook.result.current).toBe(true);
    view.unmount();
    // A press anywhere re-reads what has focus.
    act(() => { document.dispatchEvent(new Event("pointerdown")); });
    await tick(450);
    expect(hook.result.current).toBe(false);
  });
});

describe("on a device with a mouse", () => {
  it("is never active: a desktop browser has no soft keyboard to get out of the way of", () => {
    pointer(false);
    const { result } = renderHook(() => useTextEntryActive());
    render(<Fields />);
    act(() => screen.getByLabelText("notes").focus());
    expect(result.current).toBe(false);
  });
});
