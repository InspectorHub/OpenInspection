import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  seedResultsDoc,
  applyItemPatch,
  projectResults,
  setItemAttribute,
  appendPhoto,
  upsertCanned,
  upsertCustomComment,
  upsertRecommendation,
  loadResultsProjection,
} from '../../../server/lib/collab/results-doc';
import type { ResultsProjection } from '../../../server/lib/collab/results-doc.types';

const FK = '_default:s1:i1';

describe('results-doc', () => {
  it('seeds a fully-formed item map (no lazy nested create later)', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    const item = doc.getMap('results').get(FK) as Y.Map<unknown>;
    expect(item).toBeInstanceOf(Y.Map);
    expect(item.get('attributes')).toBeInstanceOf(Y.Map);
    expect(item.get('photos')).toBeInstanceOf(Y.Array);
    expect((item.get('tabs') as Y.Map<unknown>).get('defects')).toBeInstanceOf(Y.Array);
  });

  it('seed is idempotent (re-seed does not clobber values)', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    applyItemPatch(doc, FK, 'rating', 'D');
    seedResultsDoc(doc, [{ findingKey: FK }]);
    expect((doc.getMap('results').get(FK) as Y.Map<unknown>).get('rating')).toBe('D');
  });

  it('projects to the legacy data shape', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    applyItemPatch(doc, FK, 'rating', 'D');
    applyItemPatch(doc, FK, 'notes', 'cracked');
    const proj = projectResults(doc);
    expect(proj[FK].rating).toBe('D');
    expect(proj[FK].notes).toBe('cracked');
    // empty optionals omitted (matches legacy blob)
    expect(proj[FK].photos ?? []).toEqual([]);
  });

  it('two concurrent docs editing different fields of a PRE-SEEDED item both survive a merge', () => {
    const a = new Y.Doc(); const b = new Y.Doc();
    seedResultsDoc(a, [{ findingKey: FK }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // share the seeded structure
    applyItemPatch(a, FK, 'rating', 'D');
    applyItemPatch(b, FK, 'notes', 'from-b');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(projectResults(a)).toEqual(projectResults(b));
    expect(projectResults(a)[FK]).toMatchObject({ rating: 'D', notes: 'from-b' });
  });

  // ── Nested-field model (PR-7p) ───────────────────────────────────────────────

  it('nested round-trip via mutators projects ALL nested fields with correct shape', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);

    appendPhoto(doc, FK, { key: 'r2/photo-1.jpg', mediaType: 'photo' });
    upsertCanned(doc, FK, 'defects', {
      cannedId: 'd1',
      included: true,
      location: 'North wall',
      trade: 'Roofing',
    });
    setItemAttribute(doc, FK, 'yearBuilt', 1998);
    upsertRecommendation(doc, FK, {
      recommendationId: 'r1',
      estimateSnapshotMin: 100,
      estimateSnapshotMax: 200,
      summarySnapshot: 'Fix the roof',
      contractorTypeSnapshot: 'Roofer',
      attachedAt: 1700000000000,
    });
    upsertCustomComment(doc, FK, 'defects', {
      id: 'c1',
      title: 'Custom defect',
      comment: 'Observed crack',
      included: true,
    });

    const proj = projectResults(doc)[FK];
    expect(proj.photos).toEqual([{ key: 'r2/photo-1.jpg', mediaType: 'photo' }]);
    expect(proj.tabs?.defects).toEqual([
      { cannedId: 'd1', included: true, location: 'North wall', trade: 'Roofing' },
    ]);
    expect(proj.attributes).toEqual({ yearBuilt: 1998 });
    expect(proj.recommendations).toEqual([
      {
        recommendationId: 'r1',
        estimateSnapshotMin: 100,
        estimateSnapshotMax: 200,
        summarySnapshot: 'Fix the roof',
        contractorTypeSnapshot: 'Roofer',
        attachedAt: 1700000000000,
      },
    ]);
    expect(proj.customComments?.defects).toEqual([
      { id: 'c1', title: 'Custom defect', comment: 'Observed crack', included: true },
    ]);
  });

  it('concurrent photo appends merge (no loss)', () => {
    const a = new Y.Doc(); const b = new Y.Doc();
    seedResultsDoc(a, [{ findingKey: FK }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    appendPhoto(a, FK, { key: 'p1' });
    appendPhoto(b, FK, { key: 'p2' });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const keysA = (projectResults(a)[FK].photos ?? []).map((p) => p.key).sort();
    expect(keysA).toEqual(['p1', 'p2']);
    expect(projectResults(a)).toEqual(projectResults(b));
  });

  it('concurrent canned toggles merge (both defects survive)', () => {
    const a = new Y.Doc(); const b = new Y.Doc();
    seedResultsDoc(a, [{ findingKey: FK }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    upsertCanned(a, FK, 'defects', { cannedId: 'd1', included: true });
    upsertCanned(b, FK, 'defects', { cannedId: 'd2', included: true });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const ids = (projectResults(a)[FK].tabs?.defects ?? []).map((d) => d.cannedId).sort();
    expect(ids).toEqual(['d1', 'd2']);
    expect(projectResults(a)).toEqual(projectResults(b));
  });

  it('concurrent edits to different fields of the SAME defect merge', () => {
    const a = new Y.Doc(); const b = new Y.Doc();
    seedResultsDoc(a, [{ findingKey: FK }]);
    upsertCanned(a, FK, 'defects', { cannedId: 'd1', included: true });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // both share the seeded defect

    upsertCanned(a, FK, 'defects', { cannedId: 'd1', location: 'South wall' });
    upsertCanned(b, FK, 'defects', { cannedId: 'd1', trade: 'Plumbing' });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const defects = projectResults(a)[FK].tabs?.defects ?? [];
    expect(defects).toHaveLength(1);
    expect(defects[0]).toMatchObject({ cannedId: 'd1', location: 'South wall', trade: 'Plumbing' });
    expect(projectResults(a)).toEqual(projectResults(b));
  });

  it('concurrent recommendation attaches merge (both survive)', () => {
    const a = new Y.Doc(); const b = new Y.Doc();
    seedResultsDoc(a, [{ findingKey: FK }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    upsertRecommendation(a, FK, {
      recommendationId: 'r1', estimateSnapshotMin: 1, estimateSnapshotMax: 2,
      summarySnapshot: 'a', contractorTypeSnapshot: null, attachedAt: 1,
    });
    upsertRecommendation(b, FK, {
      recommendationId: 'r2', estimateSnapshotMin: 3, estimateSnapshotMax: 4,
      summarySnapshot: 'b', contractorTypeSnapshot: null, attachedAt: 2,
    });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const ids = (projectResults(a)[FK].recommendations ?? []).map((r) => r.recommendationId).sort();
    expect(ids).toEqual(['r1', 'r2']);
    expect(projectResults(a)).toEqual(projectResults(b));
  });

  // ── loadResultsProjection — inverse of projectResults (#181 DO hydration) ────

  it('loadResultsProjection round-trips a fully-populated blob (deep-equal)', () => {
    const blob: ResultsProjection = {
      '_default:s1:i1': {
        rating: 'D',
        notes: 'cracked',
        value: 'some value',
        recommendation: 'replace',
        estimateMin: 100,
        estimateMax: 500,
        followupStatus: 'repaired',
        followupNotes: 'fixed on re-inspection',
        attributes: { yearBuilt: 1998, material: 'brick' },
        photos: [
          { key: 'r2/p1.jpg', mediaType: 'photo' },
          { key: 'r2/p2.jpg', croppedKey: 'r2/p2-crop.jpg' },
        ],
        tabs: {
          information: [{ cannedId: 'info1', included: true, comment: 'note' }],
          limitations: [{ cannedId: 'lim1', included: false }],
          defects: [
            {
              cannedId: 'd1',
              included: true,
              location: 'North wall',
              category: 'safety',
              trade: 'Roofing',
            },
          ],
        },
        customComments: {
          defects: [
            { id: 'c1', title: 'Custom defect', comment: 'Observed crack', included: true, location: 'roof' },
          ],
        },
        recommendations: [
          {
            recommendationId: 'r1',
            estimateSnapshotMin: 100,
            estimateSnapshotMax: 200,
            summarySnapshot: 'Fix the roof',
            contractorTypeSnapshot: 'Roofer',
            attachedAt: 1700000000000,
          },
        ],
        original: {
          rating: 'X',
          notes: 'was broken',
          photos: [{ key: 'r2/orig.jpg' }],
        },
      },
      '_default:s1:i2': {
        rating: 'IN',
      },
    };

    const doc = new Y.Doc();
    loadResultsProjection(doc, blob);
    expect(projectResults(doc)).toEqual(blob);
  });

  it('loadResultsProjection is idempotent (reload does not duplicate array entries)', () => {
    const blob: ResultsProjection = {
      '_default:s1:i1': {
        rating: 'D',
        photos: [{ key: 'r2/p1.jpg' }],
        tabs: { defects: [{ cannedId: 'd1', included: true }] },
        customComments: { defects: [{ id: 'c1', title: 't', comment: 'c', included: true }] },
        recommendations: [
          {
            recommendationId: 'r1',
            estimateSnapshotMin: null,
            estimateSnapshotMax: null,
            summarySnapshot: 's',
            contractorTypeSnapshot: null,
            attachedAt: 1,
          },
        ],
      },
    };

    const doc = new Y.Doc();
    loadResultsProjection(doc, blob);
    loadResultsProjection(doc, blob);
    expect(projectResults(doc)).toEqual(blob);
  });

  it('loadResultsProjection produces CRDT containers that still merge after load', () => {
    const blob: ResultsProjection = {
      '_default:s1:i1': { rating: 'D', photos: [{ key: 'p1' }] },
    };
    const a = new Y.Doc();
    loadResultsProjection(a, blob);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    appendPhoto(a, FK, { key: 'p2' });
    appendPhoto(b, FK, { key: 'p3' });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const keys = (projectResults(a)[FK].photos ?? []).map((p) => p.key).sort();
    expect(keys).toEqual(['p1', 'p2', 'p3']);
    expect(projectResults(a)).toEqual(projectResults(b));
  });

  it('freshly seeded item with no nested writes projects to {} (empty-omission)', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    const proj = projectResults(doc)[FK];
    expect(proj).toEqual({});
    expect(proj.photos).toBeUndefined();
    expect(proj.customComments).toBeUndefined();
    expect(proj.recommendations).toBeUndefined();
    expect(proj.attributes).toBeUndefined();
    expect(proj.tabs).toBeUndefined();
  });
});
