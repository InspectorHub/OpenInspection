import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildCollabFindingsApi } from '../collab/collab-findings-api';
import { appendPendingPhoto, readResultMap } from '../collab/results-binding';
import { attachPhotoBatch, type AttachableBatch } from './attachPhotoBatch';
import { orderPhotoBatch } from '../shared/photo-batch-order';

const FK = '_default:s1:i1';

function setup() {
  const doc = new Y.Doc();
  const findings = buildCollabFindingsApi(doc, {
    getResult: () => ({}),
    sectionIdForItem: () => 's1',
    setResults: () => undefined,
    setDirty: () => undefined,
    setSaveStatus: () => undefined,
  });
  const labels = (): string[] =>
    ((readResultMap(doc)[FK]?.photos ?? []) as Array<{ key?: string; pendingId?: string }>).map((p) => p.key || `pending:${p.pendingId}`);
  return { doc, findings, labels };
}

/** Five files selected in order; `kept` indexes are the ones the host kept and wrote as pending entries at once. */
function batchOf(kept: number[], count = 5): AttachableBatch {
  const results = Array.from({ length: count }, (_, index) =>
    kept.includes(index) ? { index, ok: false, error: 'HTTP_503', kept: true } : { index, ok: true, key: `k${index + 1}` },
  );
  return {
    itemId: 'i1',
    targetType: 'item',
    customId: '',
    defectKind: 'canned',
    keys: results.flatMap((r) => (r.ok && r.key ? [r.key] : [])),
    results,
    pendingIds: results.map((_, i) => `p${i + 1}`),
  };
}

describe('attachPhotoBatch keeps the selection order', () => {
  it('files 2 and 3 kept as pending: the document still reads 1 2 3 4 5', () => {
    const { doc, findings, labels } = setup();
    const batch = batchOf([1, 2]);
    // The host writes a kept file's pending entry the moment its upload fails, before the batch settles.
    appendPendingPhoto(doc, FK, 'p2');
    appendPendingPhoto(doc, FK, 'p3');
    attachPhotoBatch(findings, batch);
    expect(labels()).toEqual(['k1', 'pending:p2', 'pending:p3', 'k4', 'k5']);
  });

  it('keeps earlier photos of the item in front and is idempotent', () => {
    const { doc, findings, labels } = setup();
    findings.addPhotoToItem('i1', 'old');
    const batch = batchOf([0, 4]);
    appendPendingPhoto(doc, FK, 'p1');
    appendPendingPhoto(doc, FK, 'p5');
    attachPhotoBatch(findings, batch);
    attachPhotoBatch(findings, batch);
    expect(labels()).toEqual(['old', 'pending:p1', 'k2', 'k3', 'k4', 'pending:p5']);
  });

  it('all succeeded, or a failed file in the middle: order unchanged, no extra entries', () => {
    const { findings, labels } = setup();
    const b = batchOf([]);
    b.results[2] = { index: 2, ok: false, error: 'HTTP_503' };
    b.keys = b.keys.filter((k) => k !== 'k3');
    attachPhotoBatch(findings, b);
    expect(labels()).toEqual(['k1', 'k2', 'k4', 'k5']);
  });

  it('a batch of the same item attached later stays behind an earlier batch', () => {
    const { doc, findings, labels } = setup();
    appendPendingPhoto(doc, FK, 'p2');
    attachPhotoBatch(findings, batchOf([1], 3));
    const second = batchOf([], 2);
    second.keys = ['m1', 'm2'];
    second.results = second.results.map((r, i) => ({ ...r, key: `m${i + 1}` }));
    second.pendingIds = ['q1', 'q2'];
    attachPhotoBatch(findings, second);
    expect(labels()).toEqual(['k1', 'pending:p2', 'k3', 'm1', 'm2']);
  });
});

describe('orderPhotoBatch moves only what has to move', () => {
  it('does not write at all when the batch is already in order, nor create a missing finding', () => {
    const { doc, findings } = setup();
    findings.addPhotoToItem('i1', 'k1');
    findings.addPhotoToItem('i1', 'k2');
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    findings.orderPhotoBatch('i1', [{ key: 'k1' }, { key: 'k2' }]);
    findings.orderPhotoBatch('missing-item-has-no-section', [{ key: 'x' }]);
    expect(updates).toBe(0);
    const fresh = new Y.Doc();
    orderPhotoBatch(fresh, '_default:s1:none', [{ key: 'x' }]);
    expect(fresh.getMap('results').has('_default:s1:none')).toBe(false);
  });

  it('replaces only the elements that change place', () => {
    const { findings, doc, labels } = setup();
    for (const k of ['a', 'b', 'c', 'd']) findings.addPhotoToItem('i1', k);
    const arr = (): Y.Array<unknown> => (doc.getMap('results').get(FK) as Y.Map<unknown>).get('photos') as Y.Array<unknown>;
    const before = [0, 1, 2, 3].map((i) => arr().get(i));
    findings.orderPhotoBatch('i1', [{ key: 'a' }, { key: 'd' }, { key: 'c' }]);
    expect(labels()).toEqual(['a', 'b', 'd', 'c']);
    expect(arr().get(0)).toBe(before[0]);
    expect(arr().get(1)).toBe(before[1]);
  });

  it('a kept file already resolved to a key before the batch settled is not found by pendingId and stays put (accepted limit)', () => {
    const { doc, findings, labels } = setup();
    appendPendingPhoto(doc, FK, 'p2');
    const el = (doc.getMap('results').get(FK) as Y.Map<unknown>).get('photos') as Y.Array<unknown>;
    const entry = el.get(0) as Y.Map<unknown>;
    entry.set('key', 'resolved-2');
    entry.delete('pendingId');
    attachPhotoBatch(findings, batchOf([1], 3));
    expect(labels()).toEqual(['resolved-2', 'k1', 'k3']);
  });
});

describe('attachPhotoBatch when no file was stored', () => {
  it('a batch where every file was kept: scrambled host writes read in selection order', () => {
    const { doc, findings, labels } = setup();
    for (const id of ['p3', 'p1', 'p5', 'p2', 'p4']) appendPendingPhoto(doc, FK, id);
    attachPhotoBatch(findings, batchOf([0, 1, 2, 3, 4]));
    expect(labels()).toEqual(['pending:p1', 'pending:p2', 'pending:p3', 'pending:p4', 'pending:p5']);
  });

  it('an all-failed batch (neither stored nor kept) changes nothing and writes nothing', () => {
    const { doc, findings, labels } = setup();
    appendPendingPhoto(doc, FK, 'other');
    const b = batchOf([]);
    b.results = b.results.map((r) => ({ index: r.index, ok: false, error: 'HTTP_503' }));
    b.keys = [];
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    attachPhotoBatch(findings, b);
    expect(updates).toBe(0);
    expect(labels()).toEqual(['pending:other']);
  });

  it('no item id, or an empty batch, returns early', () => {
    const { doc, findings } = setup();
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    attachPhotoBatch(findings, { ...batchOf([0, 1], 2), itemId: '' });
    attachPhotoBatch(findings, { ...batchOf([], 0), keys: [], results: [], pendingIds: [] });
    expect(updates).toBe(0);
  });

  it('an all-kept batch on a defect row is left to the host', () => {
    const { findings } = setup();
    const calls: string[] = [];
    attachPhotoBatch(
      { ...findings, orderPhotoBatch: () => calls.push('order'), addPhotoToDefect: () => calls.push('defect') },
      { ...batchOf([0, 1], 2), targetType: 'defect', customId: 'c1' },
    );
    expect(calls).toEqual([]);
  });
});
