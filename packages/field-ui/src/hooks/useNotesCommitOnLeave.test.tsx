// @vitest-environment happy-dom
/**
 * Notes are typed into state and written to the shared document when the field loses focus. Text typed and then left behind
 * without a blur (the app is backgrounded, the editor closes, the person pauses) must still reach the document: on a page
 * that is hidden or going away, on unmount, and after a short idle. A blur settles the draft so nothing is written twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useNotesCommitOnLeave } from "./useNotesCommitOnLeave";

type Api = ReturnType<typeof useNotesCommitOnLeave>;

function setup(itemId = "i1") {
  const commit = vi.fn<(text: string, itemId?: string) => void>();
  const api: { current: Api | null } = { current: null };
  function Probe({ id }: { id: string }) {
    api.current = useNotesCommitOnLeave(id, commit);
    return null;
  }
  const ui = render(<Probe id={itemId} />);
  return { commit, api, ui, rerender: (id: string) => ui.rerender(<Probe id={id} />) };
}

function hide(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("an uncommitted notes draft", () => {
  it("is committed when the page becomes hidden", () => {
    const h = setup();
    act(() => h.api.current!.track("Granule loss"));
    hide("hidden");
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("Granule loss", "i1");
  });

  it("is committed on pagehide", () => {
    const h = setup();
    act(() => h.api.current!.track("Granule loss"));
    window.dispatchEvent(new Event("pagehide"));
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("Granule loss", "i1");
  });

  it("is committed when the item editor goes away", () => {
    const h = setup();
    act(() => h.api.current!.track("Granule loss"));
    h.ui.unmount();
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("Granule loss", "i1");
  });

  it("is committed after a second without a keystroke, and each keystroke restarts the wait", () => {
    const h = setup();
    act(() => h.api.current!.track("Gran"));
    act(() => { vi.advanceTimersByTime(900); });
    act(() => h.api.current!.track("Granule"));
    act(() => { vi.advanceTimersByTime(900); });
    expect(h.commit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("Granule", "i1");
  });

  it("is written once: nothing is left to commit after the idle commit or after a blur", () => {
    const h = setup();
    act(() => h.api.current!.track("Granule"));
    act(() => { vi.advanceTimersByTime(1000); });
    window.dispatchEvent(new Event("pagehide"));
    h.ui.unmount();
    expect(h.commit).toHaveBeenCalledTimes(1);

    const b = setup();
    act(() => b.api.current!.track("Granule"));
    act(() => b.api.current!.settle()); // the field's own blur commits it
    act(() => { vi.advanceTimersByTime(5000); });
    window.dispatchEvent(new Event("pagehide"));
    expect(b.commit).not.toHaveBeenCalled();
  });

  it("CONTROL - nothing typed means nothing committed, however the page leaves", () => {
    const h = setup();
    act(() => { vi.advanceTimersByTime(5000); });
    hide("hidden");
    window.dispatchEvent(new Event("pagehide"));
    h.ui.unmount();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("goes to the item it was typed into when another item opens without a blur, and only there", () => {
    const h = setup("i1");
    act(() => h.api.current!.track("Granule"));
    h.rerender("i2");
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("Granule", "i1");
    act(() => { vi.advanceTimersByTime(2000); });
    window.dispatchEvent(new Event("pagehide"));
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it("names the item on every other path too: hidden, pagehide, unmount and the idle commit", () => {
    const idle = setup("i1");
    act(() => idle.api.current!.track("a"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(idle.commit).toHaveBeenCalledWith("a", "i1");
    const gone = setup("i7");
    act(() => gone.api.current!.track("b"));
    gone.ui.unmount();
    expect(gone.commit).toHaveBeenCalledWith("b", "i7");
  });
});

describe("an IME composition in progress", () => {
  it("is not interrupted by the idle commit, which waits and then commits after compositionend", () => {
    const h = setup();
    act(() => h.api.current!.track("\u306b\u307b"));
    act(() => h.api.current!.composition.onCompositionStart());
    act(() => { vi.advanceTimersByTime(3500); });
    expect(h.commit).not.toHaveBeenCalled();
    act(() => h.api.current!.composition.onCompositionEnd());
    act(() => { vi.advanceTimersByTime(900); });
    expect(h.commit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100); });
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("\u306b\u307b", "i1");
  });

  it("does not hold back leaving the page: hidden still commits what is typed", () => {
    const h = setup();
    act(() => h.api.current!.track("\u306b\u307b"));
    act(() => h.api.current!.composition.onCompositionStart());
    hide("hidden");
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("\u306b\u307b", "i1");
  });

  it("CONTROL - without a composition the idle commit is on time", () => {
    const h = setup();
    act(() => h.api.current!.track("ab"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("ab", "i1");
  });

  it("a composition that never reports its end does not hold the next item's idle commit back (item switch)", () => {
    const h = setup("i1");
    act(() => h.api.current!.track("ab"));
    act(() => h.api.current!.composition.onCompositionStart());
    h.rerender("i2"); // the IME never sends compositionend
    expect(h.commit).toHaveBeenCalledWith("ab", "i1");
    act(() => h.api.current!.track("cd"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(h.commit).toHaveBeenLastCalledWith("cd", "i2");
  });

  it("the same after a blur that is not followed by compositionend", () => {
    const h = setup();
    act(() => h.api.current!.composition.onCompositionStart());
    act(() => h.api.current!.settle());
    act(() => h.api.current!.track("cd"));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("cd", "i1");
  });

  it("a page that was hidden mid-composition and comes back is still composing: no idle commit until compositionend", () => {
    const h = setup();
    act(() => h.api.current!.track("ab"));
    act(() => h.api.current!.composition.onCompositionStart());
    hide("hidden");
    expect(h.commit).toHaveBeenCalledExactlyOnceWith("ab", "i1");
    hide("visible");
    act(() => h.api.current!.track("abc"));
    act(() => { vi.advanceTimersByTime(3500); });
    expect(h.commit).toHaveBeenCalledTimes(1);
    act(() => h.api.current!.composition.onCompositionEnd());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(h.commit).toHaveBeenLastCalledWith("abc", "i1");
  });
});
