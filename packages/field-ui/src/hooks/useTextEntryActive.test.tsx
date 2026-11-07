// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTextEntryActive } from "./useTextEntryActive";

afterEach(cleanup);

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

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

describe("useTextEntryActive", () => {
  it("is false until a text field has focus, true while it does, false after it is left", async () => {
    const hook = renderHook(() => useTextEntryActive());
    render(<Fields />);
    expect(hook.result.current).toBe(false);
    act(() => screen.getByLabelText("notes").focus());
    expect(hook.result.current).toBe(true);
    act(() => screen.getByLabelText("notes").blur());
    await flush();
    expect(hook.result.current).toBe(false);
  });

  it("stays true when focus moves from one text field to another", async () => {
    const hook = renderHook(() => useTextEntryActive());
    render(<Fields />);
    act(() => screen.getByLabelText("notes").focus());
    act(() => screen.getByLabelText("search").focus());
    await flush();
    expect(hook.result.current).toBe(true);
  });

  it("does not count a checkbox or a button, which raise no keyboard", async () => {
    const hook = renderHook(() => useTextEntryActive());
    render(<Fields />);
    act(() => screen.getByLabelText("tick").focus());
    await flush();
    expect(hook.result.current).toBe(false);
    act(() => screen.getByText("go").focus());
    await flush();
    expect(hook.result.current).toBe(false);
  });

  it("does not stay stuck on when the focused field is removed without a blur", async () => {
    const hook = renderHook(() => useTextEntryActive());
    const view = render(<Fields />);
    act(() => screen.getByLabelText("notes").focus());
    expect(hook.result.current).toBe(true);
    view.unmount();
    // A press anywhere re-reads what has focus.
    act(() => { document.dispatchEvent(new Event("pointerdown")); });
    await flush();
    expect(hook.result.current).toBe(false);
  });
});
