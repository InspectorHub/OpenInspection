// @vitest-environment happy-dom
/**
 * Workspace editor preferences — a failed save must not stand (IA-129).
 *
 * `patch()` updates optimistically, and the only effect consuming the response
 * handled `ok === true`. There was no else. A failed save therefore left the
 * control showing the value that had just failed to save, said nothing, and
 * reverted invisibly on the next page load — so an operator believed they had
 * changed how every inspector's editor behaves. Silence is wrong twice here: it
 * also left the page with no vocabulary for success, so a failure had nothing
 * to be contrasted against.
 *
 * A note on the harness, because the first version of this file was useless: it
 * called a fresh `render()` to observe the "after" state, which mounts a NEW
 * hook whose refs and state start empty — so it could never see a rollback, and
 * all five tests passed with the fix deleted. The rollback only exists ACROSS
 * RENDERS OF ONE INSTANCE, so the harness has to re-render the same component
 * and read the same hook. That is what `bump()` below is for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

import { useInspectionPrefs } from "~/hooks/useInspectionPrefs";

// Two fetchers are created per hook, in order: load, then patch. Each needs its
// own drivable state, or the patch lifecycle cannot be moved independently.
let fetcherIndex = 0;
let loadState: "idle" | "loading" = "idle";
let loadData: unknown = undefined;
let patchState: "idle" | "submitting" = "idle";
let patchData: unknown = undefined;
const submit = vi.fn();

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useFetcher: vi.fn(() => {
      const isLoad = fetcherIndex++ % 2 === 0;
      return isLoad
        ? { get state() { return loadState; }, get data() { return loadData; }, load: vi.fn(), submit: vi.fn(), Form: (): null => null }
        : { get state() { return patchState; }, get data() { return patchData; }, load: vi.fn(), submit, Form: (): null => null };
    }),
  };
});

type Hook = ReturnType<typeof useInspectionPrefs>;

function harness() {
  const seen: Hook[] = [];
  function Probe({ tick }: { tick: number }) {
    seen.push(useInspectionPrefs());
    return <span data-testid="tick">{tick}</span>;
  }
  let tick = 0;
  const { rerender } = render(<Probe tick={tick} />);
  return {
    latest: () => seen[seen.length - 1],
    /** Re-render the SAME component so effects re-run against the same hook. */
    bump: () => act(() => { fetcherIndex = 0; rerender(<Probe tick={++tick} />); }),
  };
}

beforeEach(() => {
  fetcherIndex = 0;
  loadState = "idle";
  loadData = undefined;
  patchState = "idle";
  patchData = undefined;
  submit.mockClear();
});

describe("useInspectionPrefs — IA-130: defaults are not an answer", () => {
  it("serves DEFAULTS and loaded:false together, so callers can tell", () => {
    const h = harness();
    expect(h.latest().loaded).toBe(false);
    expect(h.latest().prefs.autoAdvance).toBe("always");
  });

  it("only claims loaded once real prefs land", () => {
    const h = harness();
    loadData = { prefs: { ...h.latest().prefs, autoAdvance: "off" as const } };
    h.bump();
    expect(h.latest().loaded).toBe(true);
    expect(h.latest().prefs.autoAdvance).toBe("off");
  });
});

describe("useInspectionPrefs — IA-129: a failed save must not stand", () => {
  it("applies the change optimistically and submits it", () => {
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });
    expect(h.latest().prefs.autoAdvance).toBe("off");
    expect(h.latest().saveFailed).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("rolls the value back and reports the failure", () => {
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });
    expect(h.latest().prefs.autoAdvance).toBe("off");

    // The branch that did not exist.
    patchData = { ok: false, prefs: null };
    h.bump();

    expect(h.latest().prefs.autoAdvance).toBe("always");
    expect(h.latest().saveFailed).toBe(true);
  });

  it("keeps a successful save and stays quiet", () => {
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });

    patchData = { ok: true, prefs: { ...h.latest().prefs, autoAdvance: "off" as const } };
    h.bump();

    expect(h.latest().prefs.autoAdvance).toBe("off");
    expect(h.latest().saveFailed).toBe(false);
  });

  it("rolls back to where a BURST started, not to its second-to-last step", () => {
    // Consecutive edits accumulate into one submission (a shared fetcher would
    // otherwise cancel the in-flight one), so the undo target has to be the
    // state before the first of them.
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });
    act(() => { h.latest().patch({ autoAdvanceDelayMs: 900 }); });

    patchData = { ok: false, prefs: null };
    h.bump();

    expect(h.latest().prefs.autoAdvance).toBe("always");
    expect(h.latest().prefs.autoAdvanceDelayMs).toBe(200);
  });

  it("clears a previous failure when a new change is attempted", () => {
    const h = harness();
    act(() => { h.latest().patch({ autoAdvance: "off" }); });
    patchData = { ok: false, prefs: null };
    h.bump();
    expect(h.latest().saveFailed).toBe(true);

    patchData = undefined;
    act(() => { h.latest().patch({ autoAdvance: "keyboard" }); });
    expect(h.latest().saveFailed).toBe(false);
  });
});
