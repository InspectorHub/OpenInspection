// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FieldDataSourceProvider } from '../context';
import type { EditorData } from '../data-source';
import type { ResultMap } from '../data-source-types';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import { useScopeLoader } from './useScopeLoader';

afterEach(cleanup);

// Drive the hook the way the editor does: scope loads are reads through
// `FieldDataSource.load(inspectionId, scope)`, and two of them may be in flight at once
// (a fast A -> B switch), each settled by hand.
function setup(collabSynced = false) {
  const ds = createFakeDataSource({ data: createEmptyEditorData() });
  const calls: Array<{
    id: string;
    scope: string | undefined;
    resolve: (data: EditorData) => void;
    reject: (err: Error) => void;
  }> = [];
  ds.load = vi.fn(
    (id: string, scope?: string) =>
      new Promise<EditorData>((resolve, reject) => {
        calls.push({ id, scope, resolve, reject });
      }),
  );
  const onSlice = vi.fn<(slice: ResultMap) => void>();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FieldDataSourceProvider dataSource={ds}>{children}</FieldDataSourceProvider>
  );
  const view = renderHook(
    ({ synced }: { synced: boolean }) => useScopeLoader({ inspectionId: 'insp-1', collabSynced: synced, onSlice }),
    { wrapper, initialProps: { synced: collabSynced } },
  );
  const answer = (index: number, scope: string) =>
    calls[index].resolve(createEmptyEditorData({ results: slice(scope) }));
  return { view, calls, onSlice, answer, ds };
}

const slice = (scope: string): ResultMap => ({ [`${scope}:s1:i1`]: { rating: 'poor' } });
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe('useScopeLoader', () => {
  it("requests a unit scope once for the inspection, dedupes after a successful merge, skips '_default'", async () => {
    const { view, calls, onSlice, answer } = setup();

    act(() => view.result.current('u_a'));
    expect(calls.map((c) => [c.id, c.scope])).toEqual([['insp-1', 'u_a']]);

    answer(0, 'u_a');
    await flush();
    expect(onSlice).toHaveBeenCalledWith(slice('u_a'));

    // switching back to u_a no longer re-fetches (merged)
    act(() => view.result.current('u_a'));
    expect(calls).toHaveLength(1);

    // '_default' is always present from first paint, never fetched
    act(() => view.result.current(null));
    expect(calls).toHaveLength(1);
  });

  it('does not fetch when the collab doc already holds every scope', () => {
    const { view, calls } = setup(true);
    act(() => view.result.current('u_a'));
    expect(calls).toHaveLength(0);
  });

  it('keeps a superseded scope re-fetchable (the overlapping-load race)', async () => {
    const { view, calls, onSlice, answer } = setup();

    // Fast A -> B switch: both loads are in flight, only the last may land.
    act(() => view.result.current('u_a'));
    act(() => view.result.current('u_b'));
    expect(calls.map((c) => c.scope)).toEqual(['u_a', 'u_b']);

    answer(1, 'u_b');
    await flush();
    expect(onSlice).toHaveBeenCalledTimes(1);
    expect(onSlice).toHaveBeenCalledWith(slice('u_b'));

    // u_a never merged, so switching back MUST re-fetch it (under dedupe-on-request it would
    // no-op and render u_a empty until a reload).
    act(() => view.result.current('u_a'));
    expect(calls.map((c) => c.scope)).toEqual(['u_a', 'u_b', 'u_a']);
  });

  it('ignores a late answer for a scope other than the last request', async () => {
    const { view, onSlice, answer } = setup();

    act(() => view.result.current('u_a'));
    act(() => view.result.current('u_b')); // in-flight is now u_b

    answer(0, 'u_a'); // the superseded u_a arrives late
    await flush();
    expect(onSlice).not.toHaveBeenCalled();
  });

  it('does not mark a scope fetched on a failed load, so it retries', async () => {
    const { view, calls, onSlice } = setup();

    act(() => view.result.current('u_a'));
    calls[0].reject(new Error('Could not load this scope.'));
    await flush();
    expect(onSlice).not.toHaveBeenCalled();

    // failed, so still re-fetchable
    act(() => view.result.current('u_a'));
    expect(calls).toHaveLength(2);
  });

  it('a late rejection of an earlier request for the same scope does not drop the newer answer (A, B, A)', async () => {
    const { view, calls, onSlice, answer } = setup();

    act(() => view.result.current('u_a')); // request 0
    act(() => view.result.current('u_b')); // request 1
    act(() => view.result.current('u_a')); // request 2: the LAST one, for the same scope as request 0
    expect(calls).toHaveLength(3);

    calls[0].reject(new Error('network')); // the first A fails late
    await flush();

    answer(2, 'u_a'); // the newer A still lands
    await flush();
    expect(onSlice).toHaveBeenCalledTimes(1);
    expect(onSlice).toHaveBeenCalledWith(slice('u_a'));
  });

  it('merges nothing after unmount', async () => {
    const { view, onSlice, answer } = setup();
    act(() => view.result.current('u_a'));
    view.unmount();
    answer(0, 'u_a');
    await flush();
    expect(onSlice).not.toHaveBeenCalled();
  });
});
