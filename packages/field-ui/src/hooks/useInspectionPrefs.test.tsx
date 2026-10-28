// @vitest-environment happy-dom
/**
 * Workspace editor preferences: a failed save must not stand (IA-129), and defaults are
 * not an answer (IA-130).
 *
 * `patch()` updates optimistically, and a not-ok answer used to leave the control showing the
 * value that had just failed to save, with nothing said. So the rollback has to be observed
 * ACROSS UPDATES OF ONE hook instance: a fresh render would mount a new hook whose refs start
 * empty and could never see a rollback. The harness therefore renders one probe, drives the
 * data source's answers by hand, and reads the latest value the same instance returned.
 *
 * The hook talks to `FieldDataSource.resources.prefs` only; the web host serves that from the
 * `/resources/inspection-prefs` route (see app/lib/field/web-prefs.test.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { CommandResult } from '../commands';
import { FieldDataSourceProvider } from '../context';
import type { FieldResources } from '../data-source';
import type { InspectionPrefs } from '../data-source-types';
import { createEmptyEditorData, createFakeDataSource, createFakePrefs } from '../testing/fake-data-source';
import { DEFAULT_INSPECTION_PREFS, useInspectionPrefs } from './useInspectionPrefs';

afterEach(cleanup);

type Hook = ReturnType<typeof useInspectionPrefs>;

function harness(resources: FieldResources) {
  const ds = createFakeDataSource({ data: createEmptyEditorData(), resources });
  const seen: Hook[] = [];
  function Probe() {
    seen.push(useInspectionPrefs());
    return null;
  }
  render(
    <FieldDataSourceProvider dataSource={ds}>
      <Probe />
    </FieldDataSourceProvider>,
  );
  return { latest: () => seen[seen.length - 1], renders: () => seen.length };
}

/** Let the load promise and the state updates it triggers settle. */
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

/** A prefs store whose answers the test settles by hand. */
function manualStore() {
  const loads: Array<(p: InspectionPrefs) => void> = [];
  const loadFails: Array<(e: Error) => void> = [];
  const patches: Array<{ delta: Partial<InspectionPrefs>; resolve: (r: CommandResult<InspectionPrefs>) => void }> = [];
  const store: NonNullable<FieldResources['prefs']> = {
    load: vi.fn(
      () =>
        new Promise<InspectionPrefs>((resolve, reject) => {
          loads.push(resolve);
          loadFails.push(reject);
        }),
    ),
    patch: vi.fn(
      (delta: Partial<InspectionPrefs>) =>
        new Promise<CommandResult<InspectionPrefs>>((resolve) => {
          patches.push({ delta, resolve });
        }),
    ),
  };
  return { store, loads, loadFails, patches };
}

describe('useInspectionPrefs: IA-130, defaults are not an answer', () => {
  it('serves DEFAULTS and loaded:false together until the host answers, then claims loaded', async () => {
    const m = manualStore();
    const h = harness({ prefs: m.store });
    expect(h.latest().loaded).toBe(false);
    expect(h.latest().prefs).toEqual(DEFAULT_INSPECTION_PREFS);

    m.loads[0]({ ...DEFAULT_INSPECTION_PREFS, autoAdvance: 'off' });
    await flush();
    expect(h.latest().loaded).toBe(true);
    expect(h.latest().prefs.autoAdvance).toBe('off');
  });

  it('asks the host once per mount', async () => {
    const m = manualStore();
    const h = harness({ prefs: m.store });
    m.loads[0](DEFAULT_INSPECTION_PREFS);
    await flush();
    expect(h.renders()).toBeGreaterThan(1);
    expect(m.store.load).toHaveBeenCalledTimes(1);
  });

  it('a host with no preference store: the defaults are the answer, so loaded is true at once', async () => {
    const h = harness({});
    await flush();
    expect(h.latest().loaded).toBe(true);
    expect(h.latest().prefs).toEqual(DEFAULT_INSPECTION_PREFS);
  });

  it('with no store a patch still changes the local value and reports no failure', async () => {
    const h = harness({});
    await flush();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    expect(h.latest().prefs.autoAdvance).toBe('off');
    expect(h.latest().saveFailed).toBe(false);
    expect(h.latest().saving).toBe(false);
  });

  it('a load that rejects keeps the defaults and still lets the page proceed', async () => {
    const m = manualStore();
    const h = harness({ prefs: m.store });
    m.loadFails[0](new Error('offline'));
    await flush();
    expect(h.latest().loaded).toBe(true);
    expect(h.latest().prefs).toEqual(DEFAULT_INSPECTION_PREFS);
  });
});

describe('useInspectionPrefs: IA-129, a failed save must not stand', () => {
  async function loaded() {
    const m = manualStore();
    const h = harness({ prefs: m.store });
    m.loads[0](DEFAULT_INSPECTION_PREFS);
    await flush();
    return { m, h };
  }

  it('applies the change optimistically, sends it, and says saving until the answer', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    expect(h.latest().prefs.autoAdvance).toBe('off');
    expect(h.latest().saveFailed).toBe(false);
    expect(h.latest().saving).toBe(true);
    expect(m.patches).toHaveLength(1);
    expect(m.patches[0].delta).toEqual({ autoAdvance: 'off' });

    m.patches[0].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, autoAdvance: 'off' } });
    await flush();
    expect(h.latest().saving).toBe(false);
  });

  it('rolls the value back and reports the failure', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    expect(h.latest().prefs.autoAdvance).toBe('off');

    m.patches[0].resolve({ ok: false, error: 'nope' });
    await flush();
    expect(h.latest().prefs.autoAdvance).toBe('always');
    expect(h.latest().saveFailed).toBe(true);
  });

  it('a host that throws from patch is a failed save, not an unhandled rejection', async () => {
    const fake = createFakePrefs();
    const store: NonNullable<FieldResources['prefs']> = {
      load: () => fake.load(),
      patch: () => Promise.reject(new Error('boom')),
    };
    const h = harness({ prefs: store });
    await flush();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    await flush();
    expect(h.latest().prefs.autoAdvance).toBe('always');
    expect(h.latest().saveFailed).toBe(true);
  });

  it("keeps a successful save and adopts the host's merged echo", async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    // The host normalised a field the delta did not name: the echo wins over the optimistic copy.
    m.patches[0].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, autoAdvance: 'off', pinnedTagIds: ['t9'] } });
    await flush();
    expect(h.latest().prefs.autoAdvance).toBe('off');
    expect(h.latest().prefs.pinnedTagIds).toEqual(['t9']);
    expect(h.latest().saveFailed).toBe(false);
  });

  it('serialises saves: a second change is not sent until the first settled, then goes out alone', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    act(() => {
      h.latest().patch({ autoAdvanceDelayMs: 900 });
    });
    // Two requests in flight could land out of order on the server and lose the newer value.
    expect(m.patches).toHaveLength(1);
    expect(h.latest().prefs.autoAdvanceDelayMs).toBe(900);
    expect(h.latest().saving).toBe(true);

    m.patches[0].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, autoAdvance: 'off' } });
    await flush();
    expect(m.patches).toHaveLength(2);
    expect(m.patches[1].delta).toEqual({ autoAdvanceDelayMs: 900 });
    // The echo of the first request must not undo the change that is still waiting to be saved.
    expect(h.latest().prefs.autoAdvanceDelayMs).toBe(900);
    expect(h.latest().saving).toBe(true);

    m.patches[1].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, autoAdvance: 'off', autoAdvanceDelayMs: 900 } });
    await flush();
    expect(h.latest().saving).toBe(false);
    expect(h.latest().saveFailed).toBe(false);
  });

  it('changes made while a save is in flight are merged into ONE follow-up request', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    act(() => {
      h.latest().patch({ autoAdvanceDelayMs: 900 });
    });
    act(() => {
      h.latest().patch({ autoAdvanceDelayMs: 500, pinnedTagIds: ['t1'] });
    });
    m.patches[0].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, autoAdvance: 'off' } });
    await flush();
    expect(m.patches).toHaveLength(2);
    expect(m.patches[1].delta).toEqual({ autoAdvanceDelayMs: 500, pinnedTagIds: ['t1'] });
  });

  it('several list toggles in ONE act all apply: each builds on the result of the one before', async () => {
    const { m, h } = await loaded();
    const toggle = (id: string) => (current: InspectionPrefs) => ({
      pinnedTagIds: current.pinnedTagIds.includes(id) ? current.pinnedTagIds.filter((x) => x !== id) : [...current.pinnedTagIds, id],
    });
    act(() => {
      const { patch } = h.latest();
      patch(toggle('a'));
      patch(toggle('b'));
      patch(toggle('c'));
      patch(toggle('d'));
    });
    expect(h.latest().prefs.pinnedTagIds).toEqual(['a', 'b', 'c', 'd']);
    expect(m.patches).toHaveLength(1);
    m.patches[0].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, pinnedTagIds: ['a'] } });
    await flush();
    expect(m.patches).toHaveLength(2);
    expect(m.patches[1].delta).toEqual({ pinnedTagIds: ['a', 'b', 'c', 'd'] });
    m.patches[1].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, pinnedTagIds: ['a', 'b', 'c', 'd'] } });
    await flush();
    expect(h.latest().prefs.pinnedTagIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a toggle that changes nothing sends nothing', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch(() => ({}));
    });
    expect(m.patches).toHaveLength(0);
  });

  it('a failure rolls back only what THAT request changed: an earlier saved value stays', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    act(() => {
      h.latest().patch({ autoAdvanceDelayMs: 900 });
    });
    m.patches[0].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, autoAdvance: 'off' } });
    await flush();
    m.patches[1].resolve({ ok: false, error: 'nope' });
    await flush();
    expect(h.latest().prefs.autoAdvance).toBe('off');
    expect(h.latest().prefs.autoAdvanceDelayMs).toBe(200);
    expect(h.latest().saveFailed).toBe(true);
  });

  it('a failed request does not roll back a key that was edited again since, and that edit is still sent', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    act(() => {
      h.latest().patch({ autoAdvance: 'keyboard', autoAdvanceDelayMs: 900 });
    });
    m.patches[0].resolve({ ok: false, error: 'nope' });
    await flush();
    expect(h.latest().prefs.autoAdvance).toBe('keyboard');
    expect(m.patches).toHaveLength(2);
    expect(m.patches[1].delta).toEqual({ autoAdvance: 'keyboard', autoAdvanceDelayMs: 900 });
  });

  it('a failed change to a key that already saved once falls back to the saved value, not to the default', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvanceDelayMs: 900 });
    });
    m.patches[0].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, autoAdvanceDelayMs: 900 } });
    await flush();
    act(() => {
      h.latest().patch({ autoAdvanceDelayMs: 500 });
    });
    m.patches[1].resolve({ ok: false });
    await flush();
    expect(h.latest().prefs.autoAdvanceDelayMs).toBe(900);
  });

  it('a stale success must not overwrite what a newer change already shows', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    act(() => {
      h.latest().patch({ autoAdvanceDelayMs: 900 });
    });
    m.patches[0].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, autoAdvance: 'off' } });
    await flush();
    expect(h.latest().prefs.autoAdvanceDelayMs).toBe(900);
  });

  it('clears a previous failure when a new change is attempted', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    m.patches[0].resolve({ ok: false });
    await flush();
    expect(h.latest().saveFailed).toBe(true);

    act(() => {
      h.latest().patch({ autoAdvance: 'keyboard' });
    });
    expect(h.latest().saveFailed).toBe(false);
  });

  it('after a success, a LATER failure rolls back to the saved value, not to the value before the first save', async () => {
    const { m, h } = await loaded();
    act(() => {
      h.latest().patch({ autoAdvance: 'off' });
    });
    m.patches[0].resolve({ ok: true, data: { ...DEFAULT_INSPECTION_PREFS, autoAdvance: 'off' } });
    await flush();

    act(() => {
      h.latest().patch({ autoAdvanceDelayMs: 900 });
    });
    m.patches[1].resolve({ ok: false });
    await flush();
    expect(h.latest().prefs.autoAdvance).toBe('off');
    expect(h.latest().prefs.autoAdvanceDelayMs).toBe(200);
  });
});

describe('useInspectionPrefs: against the in-memory prefs store', () => {
  it('round-trips through the fake store', async () => {
    const store = createFakePrefs({ autoAdvance: 'keyboard' });
    const h = harness({ prefs: store });
    await flush();
    expect(h.latest().prefs.autoAdvance).toBe('keyboard');
    act(() => {
      h.latest().patch({ pinnedTagIds: ['a'] });
    });
    await flush();
    expect(store.patches).toEqual([{ pinnedTagIds: ['a'] }]);
    expect(h.latest().prefs.pinnedTagIds).toEqual(['a']);
  });
});
