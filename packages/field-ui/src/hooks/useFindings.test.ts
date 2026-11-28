// @vitest-environment happy-dom
/**
 * `useFindings` takes the result map, its setter and the options, and nothing else: the
 * router fetcher parameters it used to accept were never read (every write goes through the
 * Y.Doc), so removing them must change no behaviour. This pins the three behaviours the
 * editor relies on: the read path, the inert pre-connect window, and the live-doc write path.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { readResultMap } from '../collab/results-binding';
import type { ResultMap } from '../data-source-types';
import { findingKey } from './findings/shared';
import { PRE_SYNC_FLUSH_TIMEOUT_MS, useFindings } from './useFindings';

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

  // #477 — before the doc connects, a write is QUEUED (not dropped) and the
  // indicator reads "saving", never "saved": nothing has reached the server.
  it('before the doc connects, writes queue and report saving, never saved', () => {
    const opts = options();
    const setResults = vi.fn();
    const { result } = renderHook(() => useFindings({}, setResults, opts));
    result.current.setRating('s1', 'i1', 'good');
    expect(setResults).not.toHaveBeenCalled();
    expect(opts.setSaveStatus).toHaveBeenCalledWith('saving');
    expect(opts.setSaveStatus).not.toHaveBeenCalledWith('saved');
    result.current.saveNow();
    expect(opts.setSaveStatus).not.toHaveBeenCalledWith('saved');
    expect(result.current.getPhotoCount('i1')).toBe(0);
  });

  // #477 — when the doc arrives, the queued write flushes into it.
  it('flushes a pre-connect write into the doc once it connects', () => {
    const doc = new Y.Doc();
    const setSaveStatus = vi.fn();
    const { result, rerender } = renderHook(
      ({ collab }: { collab?: { doc: Y.Doc } }) =>
        useFindings({}, vi.fn(), {
          sectionIdForItem: (itemId: string) => (itemId.startsWith('i') ? 's1' : null),
          setDirty: vi.fn(),
          setSaveStatus,
          inspectionId: 'insp-1',
          collab,
        }),
      { initialProps: { collab: undefined as { doc: Y.Doc } | undefined } },
    );
    result.current.setRating('s1', 'i1', 'good');
    // commitNotes, not setNotes: setNotes is the optimistic keystroke echo
    // and only commitNotes writes the doc (on blur in the editor).
    result.current.commitNotes('s1', 'i1', 'Cracked flashing');
    expect(readResultMap(doc)[findingKey(null, 's1', 'i1')]).toBeUndefined();
    rerender({ collab: { doc } });
    expect(readResultMap(doc)[findingKey(null, 's1', 'i1')]?.rating).toBe('good');
    expect(readResultMap(doc)[findingKey(null, 's1', 'i1')]?.notes).toBe('Cracked flashing');
    expect(setSaveStatus).toHaveBeenCalledWith('saved-local');
    expect(setSaveStatus).not.toHaveBeenCalledWith('saved');
  });

  // Early-edit race — with a live doc that has NOT synced yet, doc writes
  // queue (they must not seed a competing structure before the server's
  // step2 arrives) and flush once the first sync lands.
  it('with a live doc that has not synced yet, writes queue and flush once it syncs', () => {
    const doc = new Y.Doc();
    const setSaveStatus = vi.fn();
    const renderOpts = (synced: boolean) => ({
      sectionIdForItem: (itemId: string) => (itemId.startsWith('i') ? 's1' : null),
      setDirty: vi.fn(),
      setSaveStatus,
      inspectionId: 'insp-1',
      collab: { doc, synced },
    });
    const { result, rerender } = renderHook(
      ({ synced }: { synced: boolean }) => useFindings({}, vi.fn(), renderOpts(synced)),
      { initialProps: { synced: false } },
    );
    result.current.setRating('s1', 'i1', 'good');
    result.current.commitNotes('s1', 'i1', 'Cracked flashing');
    expect(readResultMap(doc)[findingKey(null, 's1', 'i1')]).toBeUndefined();
    expect(setSaveStatus).toHaveBeenCalledWith('saving');
    rerender({ synced: true });
    expect(readResultMap(doc)[findingKey(null, 's1', 'i1')]?.rating).toBe('good');
    expect(readResultMap(doc)[findingKey(null, 's1', 'i1')]?.notes).toBe('Cracked flashing');
    expect(setSaveStatus).toHaveBeenCalledWith('saved-local');
    expect(setSaveStatus).not.toHaveBeenCalledWith('saved');
  });

  // Early-edit race — the keystroke echo must not wait for the sync: typing
  // before the first sync still shows in the textarea immediately.
  it('before the first sync, setNotes still echoes immediately', () => {
    const doc = new Y.Doc();
    const setResults = vi.fn();
    const { result } = renderHook(() =>
      useFindings({}, setResults, {
        sectionIdForItem: (itemId: string) => (itemId.startsWith('i') ? 's1' : null),
        setDirty: vi.fn(),
        setSaveStatus: vi.fn(),
        inspectionId: 'insp-1',
        collab: { doc, synced: false },
      }),
    );
    result.current.setNotes('s1', 'i1', 'Cracked');
    expect(setResults).toHaveBeenCalled();
    const updater = setResults.mock.calls[0][0] as (prev: ResultMap) => ResultMap;
    expect(updater({})[findingKey(null, 's1', 'i1')]?.notes).toBe('Cracked');
    // The echo is React state only: nothing reached the doc yet.
    expect(readResultMap(doc)[findingKey(null, 's1', 'i1')]).toBeUndefined();
  });

  // Dead-socket backstop — if the first sync never arrives, the queue still
  // reaches the local doc after PRE_SYNC_FLUSH_TIMEOUT_MS.
  it('if the first sync never arrives, the queue flushes on the timeout', () => {
    vi.useFakeTimers();
    try {
      const doc = new Y.Doc();
      const setSaveStatus = vi.fn();
      const { result } = renderHook(() =>
        useFindings({}, vi.fn(), {
          sectionIdForItem: (itemId: string) => (itemId.startsWith('i') ? 's1' : null),
          setDirty: vi.fn(),
          setSaveStatus,
          inspectionId: 'insp-1',
          collab: { doc, synced: false },
        }),
      );
      result.current.commitNotes('s1', 'i1', 'Cracked flashing');
      expect(readResultMap(doc)[findingKey(null, 's1', 'i1')]).toBeUndefined();
      act(() => {
        vi.advanceTimersByTime(PRE_SYNC_FLUSH_TIMEOUT_MS);
      });
      expect(readResultMap(doc)[findingKey(null, 's1', 'i1')]?.notes).toBe('Cracked flashing');
      expect(setSaveStatus).toHaveBeenCalledWith('saved-local');
    } finally {
      vi.useRealTimers();
    }
  });

  // #477 — with a live doc, a save flush reports "saved on this device":
  // the write reached the local doc, and only the sync step may call it saved.
  it('with a live doc, saveNow reports saved-local, never saved', () => {
    const doc = new Y.Doc();
    const opts = options({ collab: { doc } });
    const { result } = renderHook(() => useFindings({}, vi.fn(), opts));
    result.current.setRating('s1', 'i1', 'good');
    result.current.saveNow();
    expect(opts.setSaveStatus).toHaveBeenCalledWith('saved-local');
    expect(opts.setSaveStatus).not.toHaveBeenCalledWith('saved');
  });

  it('before the doc connects, adding a video reports that it was NOT written', () => {
    const { result } = renderHook(() => useFindings({}, vi.fn(), options()));
    const written = result.current.addVideoToItem('i1', { key: '', mediaType: 'video', provider: 'r2', mediaId: 'pool-1' });
    expect(written).toBe(false);
  });

  it('with a live doc, a rating is written to the doc under the scoped key', () => {
    const doc = new Y.Doc();
    const opts = options({ collab: { doc }, activeUnitId: 'u_a' });
    const { result } = renderHook(() => useFindings({}, vi.fn(), opts));
    result.current.setRating('s1', 'i1', 'good');
    expect(readResultMap(doc)[findingKey('u_a', 's1', 'i1')]?.rating).toBe('good');
  });
});
