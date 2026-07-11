/**
 * Commercial PCA Phase U (Batch C2a) — usePhotoOps per-unit scoping regression.
 *
 * `patchItemPhotos` optimistically writes the results map. Under a real unit it
 * MUST key ONLY that unit's composite finding and never the shared bare-itemId
 * slot (which holds one unit's entry, so a bare write leaks across units). At
 * `activeUnitId === null` it keeps the legacy dual-key echo (composite + bare).
 * collabDoc is null so the hook's mount-time photo scanning short-circuits.
 */
import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { usePhotoOps } from '~/hooks/usePhotoOps';
import { findingKey } from '~/hooks/findings/shared';

function makeCtx(activeUnitId: string | null) {
  let results: Record<string, Record<string, unknown>> = {};
  const setResults = vi.fn((fn: (prev: Record<string, Record<string, unknown>>) => Record<string, Record<string, unknown>>) => {
    results = fn(results);
  });
  const state = {
    inspection: { id: 'insp1', coverPhotoId: null },
    sections: [],
    results: {},
    currentSection: undefined,
    sectionIdForItem: (itemId: string) => (itemId === 'i1' ? 's1' : null),
    setResults,
    setDirty: vi.fn(),
  };
  const findings = { getResult: () => ({}) };
  const ctx = {
    state, findings, streamCustomerSubdomain: null, collabDoc: null, activeUnitId,
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(),
    setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(),
  };
  return { ctx: ctx as unknown as Parameters<typeof usePhotoOps>[0], getResults: () => results };
}

test('patchItemPhotos under a unit keys ONLY the unit composite — no bare-itemId leak', () => {
  const { ctx, getResults } = makeCtx('u1');
  const { result } = renderHook(() => usePhotoOps(ctx));
  act(() => {
    result.current.patchItemPhotos('i1', () => [{ key: 'p1' }]);
  });
  const map = getResults();
  expect(map[findingKey('u1', 's1', 'i1')]).toBeTruthy();
  // The shared bare slot MUST NOT be written under a unit.
  expect(map['i1']).toBeUndefined();
  // The common composite is also untouched.
  expect(map[findingKey(null, 's1', 'i1')]).toBeUndefined();
});

test('patchItemPhotos in the common scope keeps the legacy dual-key echo', () => {
  const { ctx, getResults } = makeCtx(null);
  const { result } = renderHook(() => usePhotoOps(ctx));
  act(() => {
    result.current.patchItemPhotos('i1', () => [{ key: 'p1' }]);
  });
  const map = getResults();
  // Common scope: both the _default composite AND the bare itemId are written.
  expect(map[findingKey(null, 's1', 'i1')]).toBeTruthy();
  expect(map['i1']).toBeTruthy();
});

test('patchItemPhotos no-ops under a unit when the section is unresolvable (no bare leak)', () => {
  const { ctx, getResults } = makeCtx('u1');
  const { result } = renderHook(() => usePhotoOps(ctx));
  act(() => {
    // 'ghost' has no section → under a unit this must NOT write the bare slot.
    result.current.patchItemPhotos('ghost', () => [{ key: 'p1' }]);
  });
  expect(getResults()['ghost']).toBeUndefined();
});
