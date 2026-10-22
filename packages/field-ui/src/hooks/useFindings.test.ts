// @vitest-environment happy-dom
/**
 * `useFindings` takes the result map, its setter and the options, and nothing else: the
 * router fetcher parameters it used to accept were never read (every write goes through the
 * Y.Doc), so removing them must change no behaviour. This pins the three behaviours the
 * editor relies on: the read path, the inert pre-connect window, and the live-doc write path.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { readResultMap } from '../collab/results-binding';
import type { ResultMap } from '../data-source-types';
import { findingKey } from './findings/shared';
import { useFindings } from './useFindings';

const options = (overrides: Partial<Parameters<typeof useFindings>[2]> = {}) => ({
  sectionIdForItem: (itemId: string) => (itemId.startsWith('i') ? 's1' : null),
  setDirty: vi.fn(),
  setSaveStatus: vi.fn(),
  inspectionId: 'insp-1',
  ...overrides,
});

describe('useFindings (results, setResults, options)', () => {
  it('reads the composite key first, then the bare item id in the common scope', () => {
    const results: ResultMap = {
      [findingKey(null, 's1', 'i1')]: { rating: 'good' },
      i2: { rating: 'poor' },
    };
    const { result } = renderHook(() => useFindings(results, vi.fn(), options()));
    expect(result.current.getResult('i1')).toEqual({ rating: 'good' });
    expect(result.current.getResult('i2')).toEqual({ rating: 'poor' });
    expect(result.current.getResult('missing')).toEqual({});
  });

  it('in a unit scope never lets the bare key shadow another unit', () => {
    const results: ResultMap = {
      i1: { rating: 'bare' },
      [findingKey('u_a', 's1', 'i1')]: { rating: 'unit-a' },
    };
    const a = renderHook(() => useFindings(results, vi.fn(), options({ activeUnitId: 'u_a' })));
    const b = renderHook(() => useFindings(results, vi.fn(), options({ activeUnitId: 'u_b' })));
    expect(a.result.current.getResult('i1')).toEqual({ rating: 'unit-a' });
    expect(b.result.current.getResult('i1')).toEqual({});
  });

  it('before the doc connects, writes are inert and the save indicator settles', () => {
    const opts = options();
    const setResults = vi.fn();
    const { result } = renderHook(() => useFindings({}, setResults, opts));
    result.current.setRating('s1', 'i1', 'good');
    expect(setResults).not.toHaveBeenCalled();
    result.current.saveNow();
    expect(opts.setSaveStatus).toHaveBeenCalledWith('saved');
    expect(result.current.getPhotoCount('i1')).toBe(0);
  });

  it('with a live doc, a rating is written to the doc under the scoped key', () => {
    const doc = new Y.Doc();
    const opts = options({ collab: { doc }, activeUnitId: 'u_a' });
    const { result } = renderHook(() => useFindings({}, vi.fn(), opts));
    result.current.setRating('s1', 'i1', 'good');
    expect(readResultMap(doc)[findingKey('u_a', 's1', 'i1')]?.rating).toBe('good');
  });
});
