// @vitest-environment happy-dom
/** A host that fires its photo-address listener once per fetched photo costs the editor one render per tick, not one per call. */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { FieldDataSourceProvider, usePhotoUrlVersion } from "../context";
import { createEmptyEditorData, createFakeDataSource } from "../testing/fake-data-source";

afterEach(cleanup);

function setup() {
  const listeners = new Set<() => void>();
  const seen: number[] = [];
  const fake = createFakeDataSource({
    data: createEmptyEditorData(),
    urls: { subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; } },
  });
  function Probe() {
    seen.push(usePhotoUrlVersion());
    return null;
  }
  const ui = render(<FieldDataSourceProvider dataSource={fake}><Probe /></FieldDataSourceProvider>);
  return { ui, listeners, seen, fire: (n: number) => { for (let i = 0; i < n; i += 1) for (const l of [...listeners]) l(); } };
}

describe("usePhotoUrlVersion", () => {
  it("turns five synchronous listener calls into one version step and one render", async () => {
    const h = setup();
    const before = h.seen.length;
    h.fire(5);
    expect(h.seen.length).toBe(before);
    await act(async () => { await Promise.resolve(); });
    expect(h.seen.at(-1)).toBe(1);
    expect(h.seen.length - before).toBe(1);
  });

  it("CONTROL - calls in separate ticks each count", async () => {
    const h = setup();
    h.fire(1);
    await act(async () => { await Promise.resolve(); });
    h.fire(1);
    await act(async () => { await Promise.resolve(); });
    expect(h.seen.at(-1)).toBe(2);
  });

  it("a call that is still queued when the editor goes away changes nothing", async () => {
    const h = setup();
    const before = h.seen.length;
    h.fire(1);
    h.ui.unmount();
    await Promise.resolve();
    expect(h.seen.length).toBe(before);
    expect(h.listeners.size).toBe(0);
  });
});
