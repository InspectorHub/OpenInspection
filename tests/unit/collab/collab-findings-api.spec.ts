import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { seedResultsDoc, projectResults } from '../../../server/lib/collab/results-doc';
import { findingKey } from '../../../server/lib/finding-key';
import { readResultMap, type ResultMap } from '../../../app/lib/collab/results-binding';
import {
    buildCollabFindingsApi,
    type CollabFindingsDeps,
} from '../../../app/lib/collab/collab-findings-api';

// ─── Harness ───────────────────────────────────────────────────────────────────

const FK_I1 = findingKey(null, 's1', 'i1');
const FK_I2 = findingKey(null, 's1', 'i2');

/**
 * Build a fresh doc seeded with two findings (i1, i2 in section s1) plus an api
 * wired to stub deps. `getResult` is backed by `readResultMap(doc)` so reads
 * reflect the live doc; `setResults` is a spy that also keeps an in-memory mirror
 * so the optimistic notes echo is observable.
 */
function makeHarness() {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK_I1 }, { findingKey: FK_I2 }]);

    let local: ResultMap = readResultMap(doc);
    const setResults = vi.fn((fn: (prev: ResultMap) => ResultMap) => {
        local = fn(local);
    });
    const setDirty = vi.fn();
    const setSaveStatus = vi.fn();

    const deps: CollabFindingsDeps = {
        getResult: (itemId, sectionId) => {
            const map = readResultMap(doc);
            if (sectionId) {
                const fk = findingKey(null, sectionId, itemId);
                return (map[fk] as Record<string, unknown>) ?? (map[itemId] as Record<string, unknown>) ?? {};
            }
            return (map[itemId] as Record<string, unknown>) ?? {};
        },
        sectionIdForItem: (itemId) => (itemId === 'i1' || itemId === 'i2' ? 's1' : null),
        setResults,
        setDirty,
        setSaveStatus,
    };

    const api = buildCollabFindingsApi(doc, deps);
    return { doc, api, setResults, setDirty, setSaveStatus, getLocal: () => local };
}

// ─── 1. setRating ────────────────────────────────────────────────────────────

describe('collab-findings-api – setRating', () => {
    it('writes the rating to the doc', () => {
        const { doc, api, setDirty } = makeHarness();
        api.setRating('s1', 'i1', 'NI');
        expect(projectResults(doc)[FK_I1].rating).toBe('NI');
        expect(setDirty).toHaveBeenCalledWith(true);
    });
});

// ─── 2. setNotes optimistic-only vs commitNotes ────────────────────────────────

describe('collab-findings-api – notes split', () => {
    it('setNotes does NOT touch the doc but echoes optimistically via setResults', () => {
        const { doc, api, setResults, getLocal } = makeHarness();
        api.setNotes('s1', 'i1', 'cursor-safe text');

        // Doc untouched — projection has no notes for this finding.
        expect(projectResults(doc)[FK_I1].notes).toBeUndefined();

        // Optimistic local echo happened under both keys.
        expect(setResults).toHaveBeenCalledTimes(1);
        const local = getLocal();
        expect((local[FK_I1] as Record<string, unknown>).notes).toBe('cursor-safe text');
        expect((local['i1'] as Record<string, unknown>).notes).toBe('cursor-safe text');
    });

    it('commitNotes writes the notes to the doc', () => {
        const { doc, api } = makeHarness();
        api.commitNotes('s1', 'i1', 'committed text');
        expect(projectResults(doc)[FK_I1].notes).toBe('committed text');
    });
});

// ─── 3. nested writes reflect in the doc projection ─────────────────────────────

describe('collab-findings-api – nested writes reflect in doc', () => {
    it('toggleCannedComment + setDefectFields', () => {
        const { doc, api } = makeHarness();
        api.toggleCannedComment('s1', 'i1', 'defects', 'd1', true);
        api.setDefectFields('s1', 'i1', 'd1', { location: 'North wall' });
        const defect = projectResults(doc)[FK_I1].tabs?.defects?.find((d) => d.cannedId === 'd1');
        expect(defect?.included).toBe(true);
        expect(defect?.location).toBe('North wall');
    });

    it('insertComment appends to notes in the doc', () => {
        const { doc, api } = makeHarness();
        api.commitNotes('s1', 'i1', 'first');
        api.insertComment('s1', 'i1', 'second');
        expect(projectResults(doc)[FK_I1].notes).toBe('first\nsecond');
    });

    it('addCustomDefect + toggleCustomDefect', () => {
        const { doc, api } = makeHarness();
        api.addCustomDefect('s1', 'i1', {
            id: 'c1',
            title: 'Custom',
            comment: 'note',
            included: true,
        });
        api.toggleCustomDefect('s1', 'i1', 'c1', false);
        const custom = projectResults(doc)[FK_I1].customComments?.defects?.find((d) => d.id === 'c1');
        expect(custom?.included).toBe(false);
    });

    it('attachRepairItem + detachRepairItem', () => {
        const { doc, api } = makeHarness();
        const snap = {
            recommendationId: 'r1',
            estimateSnapshotMin: 100,
            estimateSnapshotMax: 200,
            summarySnapshot: 'Replace pipe',
            contractorTypeSnapshot: 'plumber',
            attachedAt: 1700000000000,
        };
        api.attachRepairItem('i1', snap);
        expect(projectResults(doc)[FK_I1].recommendations?.some((r) => r.recommendationId === 'r1')).toBe(true);

        api.detachRepairItem('i1', 'r1');
        // Projection omits an empty recommendations array, so `r1` is simply gone.
        const recs = projectResults(doc)[FK_I1].recommendations ?? [];
        expect(recs.some((r) => r.recommendationId === 'r1')).toBe(false);
    });

    it('addPhotoToItem appends a photo to the finding', () => {
        const { doc, api } = makeHarness();
        api.addPhotoToItem('i1', 'r2/photo.jpg');
        expect(projectResults(doc)[FK_I1].photos?.some((p) => p.key === 'r2/photo.jpg')).toBe(true);
    });

    it('addPhotoToDefect attaches a photo to a canned defect', () => {
        const { doc, api } = makeHarness();
        api.toggleCannedComment('s1', 'i1', 'defects', 'd1', true);
        api.addPhotoToDefect('i1', { kind: 'canned', id: 'd1' }, 'r2/defect.jpg');
        const defect = projectResults(doc)[FK_I1].tabs?.defects?.find((d) => d.cannedId === 'd1');
        expect(defect?.photos?.some((p) => p.key === 'r2/defect.jpg')).toBe(true);
    });
});

// ─── 4. cloneLast ───────────────────────────────────────────────────────────────

describe('collab-findings-api – cloneLast', () => {
    const sectionItems = [{ id: 'i1' }, { id: 'i2' }];

    it('copies a prior rated item rating onto the target (scope=rating)', () => {
        const { doc, api } = makeHarness();
        api.setRating('s1', 'i1', 'D'); // prior item rated
        const ok = api.cloneLast('s1', 'i2', sectionItems, 'rating');
        expect(ok).toBe(true);
        expect(projectResults(doc)[FK_I2].rating).toBe('D');
    });

    it('copies rating AND notes for scope=rating_notes', () => {
        const { doc, api } = makeHarness();
        api.setRating('s1', 'i1', 'D');
        api.commitNotes('s1', 'i1', 'prior notes');
        const ok = api.cloneLast('s1', 'i2', sectionItems, 'rating_notes');
        expect(ok).toBe(true);
        expect(projectResults(doc)[FK_I2].rating).toBe('D');
        expect(projectResults(doc)[FK_I2].notes).toBe('prior notes');
    });

    it('returns false when no prior rated item exists', () => {
        const { api } = makeHarness();
        const ok = api.cloneLast('s1', 'i2', sectionItems, 'rating');
        expect(ok).toBe(false);
    });
});

// ─── 5. batchSetRating ──────────────────────────────────────────────────────────

describe('collab-findings-api – batchSetRating', () => {
    it('sets the level on each selected item and returns the count', () => {
        const { doc, api } = makeHarness();
        const items = [{ id: 'i1' }, { id: 'i2' }];
        const count = api.batchSetRating('s1', items, { i1: true, i2: false }, 'NP');
        expect(count).toBe(1);
        expect(projectResults(doc)[FK_I1].rating).toBe('NP');
        expect(projectResults(doc)[FK_I2].rating).toBeUndefined();
    });
});

// ─── 6. saveNow / debounceSave are no-ops on the doc ────────────────────────────

describe('collab-findings-api – save no-ops', () => {
    it('saveNow and debounceSave do not throw and do not mutate the doc', () => {
        const { doc, api, setSaveStatus } = makeHarness();
        const before = JSON.stringify(projectResults(doc));
        expect(() => api.debounceSave()).not.toThrow();
        expect(() => api.saveNow()).not.toThrow();
        expect(JSON.stringify(projectResults(doc))).toBe(before);
        expect(setSaveStatus).toHaveBeenCalledWith('saved');
    });
});
