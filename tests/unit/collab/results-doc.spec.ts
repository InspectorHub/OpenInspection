import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  seedResultsDoc,
  applyItemPatch,
  projectResults,
  setItemAttribute,
  appendPhoto,
  updatePhoto,
  removePhoto,
  revertPhoto,
  replacePhoto,
  reorderPhotos,
  movePhoto,
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

  // ── Photo ARRAY ops (#181, Task 13a-1) ───────────────────────────────────────

  it('reorderPhotos: permutation round-trips through projectResults', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'p1' });
    appendPhoto(doc, FK, { key: 'p2', mediaType: 'photo' });
    appendPhoto(doc, FK, { key: 'p3' });

    reorderPhotos(doc, FK, ['p3', 'p1', 'p2']);

    const photos = projectResults(doc)[FK].photos ?? [];
    expect(photos.map((p) => p.key)).toEqual(['p3', 'p1', 'p2']);
    // Per-photo derivative fields survive the wholesale rebuild.
    expect(photos.find((p) => p.key === 'p2')?.mediaType).toBe('photo');
  });

  it('reorderPhotos: NON-permutation (missing / extra / duplicate) is a no-op', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'p1' });
    appendPhoto(doc, FK, { key: 'p2' });
    appendPhoto(doc, FK, { key: 'p3' });

    reorderPhotos(doc, FK, ['p3', 'p1']);            // missing p2
    expect((projectResults(doc)[FK].photos ?? []).map((p) => p.key)).toEqual(['p1', 'p2', 'p3']);

    reorderPhotos(doc, FK, ['p1', 'p2', 'p4']);      // extra/unknown p4
    expect((projectResults(doc)[FK].photos ?? []).map((p) => p.key)).toEqual(['p1', 'p2', 'p3']);

    reorderPhotos(doc, FK, ['p1', 'p1', 'p2']);      // duplicate p1
    expect((projectResults(doc)[FK].photos ?? []).map((p) => p.key)).toEqual(['p1', 'p2', 'p3']);
  });

  it('movePhoto: relocates the photo (gone from source, present on target)', () => {
    const FK2 = '_default:s1:i2';
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }, { findingKey: FK2 }]);
    appendPhoto(doc, FK, { key: 'p1', mediaType: 'photo' });
    appendPhoto(doc, FK, { key: 'p2' });

    movePhoto(doc, FK, FK2, 'p1');

    const proj = projectResults(doc);
    expect((proj[FK].photos ?? []).map((p) => p.key)).toEqual(['p2']);
    expect((proj[FK2].photos ?? []).map((p) => p.key)).toEqual(['p1']);
    // Carried fields survive the move.
    expect((proj[FK2].photos ?? [])[0].mediaType).toBe('photo');
  });

  it('movePhoto: absent photo is a no-op', () => {
    const FK2 = '_default:s1:i2';
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }, { findingKey: FK2 }]);
    appendPhoto(doc, FK, { key: 'p1' });

    movePhoto(doc, FK, FK2, 'nope');

    const proj = projectResults(doc);
    expect((proj[FK].photos ?? []).map((p) => p.key)).toEqual(['p1']);
    expect(proj[FK2].photos).toBeUndefined();
  });

  it('two concurrent moves of DIFFERENT photos both survive (CRDT merge)', () => {
    const FK2 = '_default:s1:i2';
    const a = new Y.Doc();
    seedResultsDoc(a, [{ findingKey: FK }, { findingKey: FK2 }]);
    appendPhoto(a, FK, { key: 'p1' });
    appendPhoto(a, FK, { key: 'p2' });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    movePhoto(a, FK, FK2, 'p1');
    movePhoto(b, FK, FK2, 'p2');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const proj = projectResults(a);
    expect((proj[FK2].photos ?? []).map((p) => p.key).sort()).toEqual(['p1', 'p2']);
    expect(proj[FK].photos ?? []).toEqual([]);
    expect(projectResults(a)).toEqual(projectResults(b));
  });

  it('updatePhoto CANNOT clear a field (assignFields skips undefined) — documents why revert replaces', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'p1', croppedKey: 'p1-cropped', annotatedKey: 'p1-annot' });

    updatePhoto(doc, FK, 'p1', { croppedKey: undefined, annotatedKey: undefined });

    const photo = (projectResults(doc)[FK].photos ?? [])[0];
    // Derivatives are STILL present — updatePhoto with undefined is a no-op clear.
    expect(photo.croppedKey).toBe('p1-cropped');
    expect(photo.annotatedKey).toBe('p1-annot');
  });

  it('revertPhoto strips ALL derivatives in the projection (replace-by-key)', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'p0' });
    appendPhoto(doc, FK, {
      key: 'p1',
      croppedKey: 'p1-cropped',
      annotatedKey: 'p1-annot',
      annotationsJson: '{"shapes":[]}',
    });
    appendPhoto(doc, FK, { key: 'p2' });

    revertPhoto(doc, FK, 'p1');

    const photos = projectResults(doc)[FK].photos ?? [];
    // Position preserved (replace-in-place), order intact.
    expect(photos.map((p) => p.key)).toEqual(['p0', 'p1', 'p2']);
    const reverted = photos.find((p) => p.key === 'p1');
    expect(reverted).toEqual({ key: 'p1' }); // ONLY key — no derivatives remain
    expect(reverted?.croppedKey).toBeUndefined();
    expect(reverted?.annotatedKey).toBeUndefined();
    expect(reverted?.annotationsJson).toBeUndefined();
  });

  it('#181 replacePhoto drops the annotation on crop (replace-in-place, exact fields)', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'p0' });
    appendPhoto(doc, FK, {
      key: 'p1',
      annotatedKey: 'p1-annot',
      annotationsJson: '{"shapes":[]}',
      mediaType: 'photo',
    });
    appendPhoto(doc, FK, { key: 'p2' });

    // Crop: set croppedKey + crop, preserve mediaType, DROP the annotation.
    replacePhoto(doc, FK, 'p1', {
      key: 'p1',
      croppedKey: 'p1-cropped',
      crop: { aspect: 'free', orientation: 'landscape', x: 0, y: 0, width: 100, height: 80 },
      mediaType: 'photo',
    });

    const photos = projectResults(doc)[FK].photos ?? [];
    // Position preserved (replace-in-place), order intact.
    expect(photos.map((p) => p.key)).toEqual(['p0', 'p1', 'p2']);
    const cropped = photos.find((p) => p.key === 'p1');
    expect(cropped?.croppedKey).toBe('p1-cropped');
    expect(cropped?.crop).toMatchObject({ aspect: 'free', width: 100, height: 80 });
    expect(cropped?.mediaType).toBe('photo');         // non-annotation field survives
    expect(cropped?.annotatedKey).toBeUndefined();    // dropped by the crop
    expect(cropped?.annotationsJson).toBeUndefined();
  });

  it('#181 replacePhoto is a no-op when the key is absent', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'p0' });
    replacePhoto(doc, FK, 'missing', { key: 'missing', croppedKey: 'x' });
    const photos = projectResults(doc)[FK].photos ?? [];
    expect(photos.map((p) => p.key)).toEqual(['p0']);
  });

  it('removePhoto deletes the matching entry by key', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'p1' });
    appendPhoto(doc, FK, { key: 'p2' });

    removePhoto(doc, FK, 'p1');

    expect((projectResults(doc)[FK].photos ?? []).map((p) => p.key)).toEqual(['p2']);
  });

  it('#181 PR-G a pending PhotoEntry round-trips through projectResults/loadResultsProjection', () => {
    // A pending upload carries an empty `key` + pendingUpload + pendingId, no
    // R2 derivative. It must survive the projection round-trip untouched so the
    // doc can hold it offline until the upload queue swaps in the real key.
    const projection: ResultsProjection = {
      [FK]: {
        photos: [
          { key: 'real-r2-key' },
          { key: '', pendingUpload: true, pendingId: 'p1' },
        ],
      },
    };

    const doc = new Y.Doc();
    loadResultsProjection(doc, projection);
    const out = projectResults(doc);

    expect(out[FK].photos).toEqual(projection[FK].photos);
    const pending = (out[FK].photos ?? []).find((p) => p.pendingUpload === true);
    expect(pending?.pendingId).toBe('p1');
    expect(pending?.key).toBe('');
  });
});
