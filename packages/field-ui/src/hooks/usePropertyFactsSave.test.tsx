// @vitest-environment happy-dom
/**
 * The property-facts strip hands over a FULL snapshot of every field on each commit, so the newest
 * snapshot is the only one that must not be lost. A plain guarded write drops a commit made while another
 * is in flight (the edit would be lost); the fetcher this replaced cancelled the superseded submit instead.
 * These tests drive the hook with a data source whose `execute` the test parks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CommandResult, FieldCommand } from '../commands';
import { FieldDataSourceProvider } from '../context';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { FakeDataSource } from '../testing/fake-data-source';
import { usePropertyFactsSave } from './usePropertyFactsSave';

afterEach(cleanup);

function setup() {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  const calls: Array<{ inspectionId: string; cmd: FieldCommand; settle: (r: CommandResult<undefined>) => void }> = [];
  vi.spyOn(fake, 'execute').mockImplementation(((inspectionId: string, cmd: FieldCommand) =>
    new Promise<CommandResult<undefined>>((resolve) =>
      calls.push({ inspectionId, cmd, settle: resolve }),
    )) as FakeDataSource['execute']);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FieldDataSourceProvider dataSource={fake}>{children}</FieldDataSourceProvider>
  );
  const hook = renderHook(() => usePropertyFactsSave('insp-1'), { wrapper });
  return { calls, hook };
}

const payloadOf = (cmd: FieldCommand | undefined) =>
  cmd?.type === 'save-property-facts' ? cmd.payload : undefined;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

describe('usePropertyFactsSave', () => {
  it('sends the snapshot as a save-property-facts command for the inspection', () => {
    const { calls, hook } = setup();
    act(() => hook.result.current({ yearBuilt: 1990, sqft: null }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.inspectionId).toBe('insp-1');
    expect(calls[0]!.cmd).toEqual({ type: 'save-property-facts', payload: { yearBuilt: 1990, sqft: null } });
  });

  it('LATEST WINS: commits made while one is in flight collapse to the newest, sent after the first settles', async () => {
    const { calls, hook } = setup();
    act(() => {
      hook.result.current({ yearBuilt: 1 });
      hook.result.current({ yearBuilt: 1, sqft: 2 });
      hook.result.current({ yearBuilt: 1, sqft: 2, county: 'Travis' });
    });
    // Only the first is on the wire.
    expect(calls.map((c) => payloadOf(c.cmd))).toEqual([{ yearBuilt: 1 }]);
    calls[0]!.settle({ ok: true });
    await flush();
    // The middle snapshot was superseded, never sent; the newest is.
    expect(calls.map((c) => payloadOf(c.cmd))).toEqual([{ yearBuilt: 1 }, { yearBuilt: 1, sqft: 2, county: 'Travis' }]);
    calls[1]!.settle({ ok: true });
    await flush();
    expect(payloadOf(calls[calls.length - 1]!.cmd)).toEqual({ yearBuilt: 1, sqft: 2, county: 'Travis' });
  });

  it('a refused first save does not lose the next snapshot', async () => {
    const { calls, hook } = setup();
    act(() => {
      hook.result.current({ yearBuilt: 1 });
      hook.result.current({ yearBuilt: 1, sqft: 2 });
    });
    calls[0]!.settle({ ok: false, error: 'boom' });
    await flush();
    expect(calls.map((c) => payloadOf(c.cmd))).toEqual([{ yearBuilt: 1 }, { yearBuilt: 1, sqft: 2 }]);
  });

  it('the same snapshot twice in one frame is sent once', () => {
    const { calls, hook } = setup();
    act(() => {
      hook.result.current({ yearBuilt: 1 });
      hook.result.current({ yearBuilt: 1 });
    });
    expect(calls).toHaveLength(1);
  });

  it('CONTROL - a snapshot after the channel is idle again goes straight out', async () => {
    const { calls, hook } = setup();
    act(() => hook.result.current({ yearBuilt: 1 }));
    calls[0]!.settle({ ok: true });
    await flush();
    act(() => hook.result.current({ yearBuilt: 2 }));
    expect(calls.map((c) => payloadOf(c.cmd))).toEqual([{ yearBuilt: 1 }, { yearBuilt: 2 }]);
  });

  it('keeps one function identity across renders, so a form that depends on it does not resubscribe', () => {
    const { hook } = setup();
    const first = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(first);
  });
});
