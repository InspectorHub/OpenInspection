import { describe, it, expect } from 'vitest';
import { mergeResults, type ResultsBlob } from '../../server/services/diff3.service';

const base: ResultsBlob = {
    item1: { status: 'satisfactory', notes: 'Original note.', photos: [{ key: 'p1' }], updatedAt: 1 },
};

describe('mergeResults', () => {
    it('returns ours when server has not changed', () => {
        const ours = { ...base, item1: { ...base.item1, notes: 'Inspector edit.', updatedAt: 2 } };
        const out = mergeResults(base, ours, base);
        expect(out.merged).toEqual(ours);
        expect(out.conflicts).toHaveLength(0);
    });

    it('takes union of photos (each side adds different photos)', () => {
        const ours = { ...base, item1: { ...base.item1, photos: [{ key: 'p1' }, { key: 'p2' }], updatedAt: 2 } };
        const theirs = { ...base, item1: { ...base.item1, photos: [{ key: 'p1' }, { key: 'p3' }], updatedAt: 2 } };
        const out = mergeResults(base, ours, theirs);
        const photoKeys = (out.merged.item1.photos || []).map(p => p.key).sort();
        expect(photoKeys).toEqual(['p1', 'p2', 'p3']);
    });

    it('LWW status: takes whichever side has higher updatedAt', () => {
        const ours   = { ...base, item1: { ...base.item1, status: 'monitor',  updatedAt: 5 } };
        const theirs = { ...base, item1: { ...base.item1, status: 'defect',   updatedAt: 9 } };
        const out = mergeResults(base, ours, theirs);
        expect(out.merged.item1.status).toBe('defect');
    });

    it('diff3 auto-merges non-overlapping notes edits', () => {
        const baseNotes   = 'Line A.\nLine B.\nLine C.';
        const oursNotes   = 'Line A modified.\nLine B.\nLine C.';
        const theirsNotes = 'Line A.\nLine B.\nLine C modified.';
        const b: ResultsBlob = { item1: { status: 'satisfactory', notes: baseNotes,   photos: [], updatedAt: 0 } };
        const o: ResultsBlob = { item1: { status: 'satisfactory', notes: oursNotes,   photos: [], updatedAt: 1 } };
        const t: ResultsBlob = { item1: { status: 'satisfactory', notes: theirsNotes, photos: [], updatedAt: 1 } };
        const out = mergeResults(b, o, t);
        expect(out.conflicts).toHaveLength(0);
        expect(out.merged.item1.notes).toContain('Line A modified.');
        expect(out.merged.item1.notes).toContain('Line C modified.');
    });

    it('flags genuine collision when both sides edit the same line', () => {
        const b: ResultsBlob = { item1: { status: 'satisfactory', notes: 'Original.', photos: [], updatedAt: 0 } };
        const o: ResultsBlob = { item1: { status: 'satisfactory', notes: 'Inspector.', photos: [], updatedAt: 1 } };
        const t: ResultsBlob = { item1: { status: 'satisfactory', notes: 'Office.',    photos: [], updatedAt: 1 } };
        const out = mergeResults(b, o, t);
        expect(out.conflicts).toHaveLength(1);
        expect(out.conflicts[0]).toMatchObject({ itemId: 'item1', field: 'notes' });
    });

    it('handles missing item on one side as add', () => {
        const o: ResultsBlob = { ...base, item2: { status: 'defect', notes: 'New item.', photos: [], updatedAt: 5 } };
        const out = mergeResults(base, o, base);
        expect(out.merged.item2).toBeDefined();
        expect(out.merged.item2.status).toBe('defect');
    });

    it('takes union of recommendations (each side adds different recs)', () => {
        const baseR: ResultsBlob = { item1: { status: 'satisfactory', notes: '', photos: [], updatedAt: 1 } };
        const ours: ResultsBlob   = { item1: { status: 'satisfactory', notes: '', photos: [], updatedAt: 2,
            recommendations: [{ recommendationId: 'r_A', estimateSnapshotMin: null, estimateSnapshotMax: null, summarySnapshot: 'A', attachedAt: 100 }] } };
        const theirs: ResultsBlob = { item1: { status: 'satisfactory', notes: '', photos: [], updatedAt: 2,
            recommendations: [{ recommendationId: 'r_B', estimateSnapshotMin: null, estimateSnapshotMax: null, summarySnapshot: 'B', attachedAt: 100 }] } };
        const out = mergeResults(baseR, ours, theirs);
        const ids = (out.merged.item1.recommendations || []).map(r => r.recommendationId).sort();
        expect(ids).toEqual(['r_A', 'r_B']);
        expect(out.conflicts).toHaveLength(0);
    });

    it('dedupes recommendations by recommendationId', () => {
        const baseR: ResultsBlob = { item1: { status: 'satisfactory', notes: '', photos: [], updatedAt: 1 } };
        const ours: ResultsBlob   = { item1: { status: 'satisfactory', notes: '', photos: [], updatedAt: 2,
            recommendations: [{ recommendationId: 'r_A', estimateSnapshotMin: 100, estimateSnapshotMax: 200, summarySnapshot: 'A-ours', attachedAt: 100 }] } };
        const theirs: ResultsBlob = { item1: { status: 'satisfactory', notes: '', photos: [], updatedAt: 2,
            recommendations: [{ recommendationId: 'r_A', estimateSnapshotMin: 100, estimateSnapshotMax: 200, summarySnapshot: 'A-theirs', attachedAt: 100 }] } };
        const out = mergeResults(baseR, ours, theirs);
        expect((out.merged.item1.recommendations || []).length).toBe(1);
    });

    it('handles missing recommendations field on either side', () => {
        const baseR: ResultsBlob = { item1: { status: 'satisfactory', notes: '', photos: [], updatedAt: 1 } };
        const ours: ResultsBlob   = { item1: { status: 'satisfactory', notes: '', photos: [], updatedAt: 2,
            recommendations: [{ recommendationId: 'r_A', estimateSnapshotMin: null, estimateSnapshotMax: null, summarySnapshot: 'A', attachedAt: 100 }] } };
        const out = mergeResults(baseR, ours, baseR);
        expect((out.merged.item1.recommendations || []).map(r => r.recommendationId)).toEqual(['r_A']);
    });
});

// ─── Iter-2 bug #11 — dirty-field map narrows the conflict surface ─────────
describe('mergeResults dirtyFields (iter-2 bug #11)', () => {
    it('takes theirs silently for fields the user did not edit, even when ours differs', () => {
        // The local `ours.notes` happens to differ from base — say a stale
        // snapshot — but the user did not edit `notes` on this item. Server
        // has a real edit. Without dirty-tracking diff3 would surface a
        // conflict; with it, theirs wins quietly.
        const b: ResultsBlob = { item1: { status: 'satisfactory', notes: 'Original.', photos: [], updatedAt: 0 } };
        const o: ResultsBlob = { item1: { status: 'satisfactory', notes: 'Stale local.', photos: [], updatedAt: 1 } };
        const t: ResultsBlob = { item1: { status: 'satisfactory', notes: 'Server edit.', photos: [], updatedAt: 5 } };
        const out = mergeResults(b, o, t, { item1: [] });
        expect(out.conflicts).toHaveLength(0);
        expect(out.merged.item1.notes).toBe('Server edit.');
    });

    it('still surfaces a conflict when the user did edit notes on this item', () => {
        const b: ResultsBlob = { item1: { status: 'satisfactory', notes: 'Original.', photos: [], updatedAt: 0 } };
        const o: ResultsBlob = { item1: { status: 'satisfactory', notes: 'Inspector.', photos: [], updatedAt: 1 } };
        const t: ResultsBlob = { item1: { status: 'satisfactory', notes: 'Office.',    photos: [], updatedAt: 1 } };
        const out = mergeResults(b, o, t, { item1: ['notes'] });
        expect(out.conflicts).toHaveLength(1);
        expect(out.conflicts[0]).toMatchObject({ itemId: 'item1', field: 'notes' });
    });

    it('non-dirty status takes theirs even when ours has higher updatedAt', () => {
        // User did not change status. Server flipped it. Local updatedAt is
        // newer (e.g. they edited notes elsewhere). Dirty map says only notes
        // is dirty, so status must take theirs even though LWW would say ours.
        const b: ResultsBlob = { item1: { status: 'satisfactory', notes: '', photos: [], updatedAt: 0 } };
        const o: ResultsBlob = { item1: { status: 'satisfactory', notes: 'note', photos: [], updatedAt: 10 } };
        const t: ResultsBlob = { item1: { status: 'defect',       notes: '',     photos: [], updatedAt: 5 } };
        const out = mergeResults(b, o, t, { item1: ['notes'] });
        expect(out.merged.item1.status).toBe('defect');
    });

    it('empty dirty list short-circuits to theirs but still unions photos', () => {
        // Server-side write only — admin toggled something; the inspector
        // didn't touch this item. But background photo uploads still
        // happened (queued before the admin write). Photos must survive.
        const b: ResultsBlob = { item1: { status: 'satisfactory', notes: 'orig', photos: [{ key: 'p1' }], updatedAt: 0 } };
        const o: ResultsBlob = { item1: { status: 'satisfactory', notes: 'orig', photos: [{ key: 'p1' }, { key: 'p_new' }], updatedAt: 1 } };
        const t: ResultsBlob = { item1: { status: 'defect',       notes: 'admin edit', photos: [{ key: 'p1' }], updatedAt: 5 } };
        const out = mergeResults(b, o, t, { item1: [] });
        expect(out.conflicts).toHaveLength(0);
        expect(out.merged.item1.status).toBe('defect');
        expect(out.merged.item1.notes).toBe('admin edit');
        const keys = (out.merged.item1.photos || []).map(p => p.key).sort();
        expect(keys).toEqual(['p1', 'p_new']);
    });

    it('per-item dirty mask: dirty on item1 does not affect item2', () => {
        const b: ResultsBlob = {
            item1: { status: 'satisfactory', notes: 'orig1', photos: [], updatedAt: 0 },
            item2: { status: 'satisfactory', notes: 'orig2', photos: [], updatedAt: 0 },
        };
        const o: ResultsBlob = {
            item1: { status: 'satisfactory', notes: 'mine',  photos: [], updatedAt: 1 },
            item2: { status: 'satisfactory', notes: 'stale', photos: [], updatedAt: 1 },
        };
        const t: ResultsBlob = {
            item1: { status: 'satisfactory', notes: 'theirs', photos: [], updatedAt: 1 },
            item2: { status: 'satisfactory', notes: 'admin',  photos: [], updatedAt: 1 },
        };
        // Only item1.notes is dirty. item2 should silently take theirs.
        const out = mergeResults(b, o, t, { item1: ['notes'], item2: [] });
        expect(out.merged.item2.notes).toBe('admin');
        // item1 has both sides editing notes — that's a real conflict.
        expect(out.conflicts).toHaveLength(1);
        expect(out.conflicts[0]?.itemId).toBe('item1');
    });

    it('omitting dirtyFields preserves pre-bug-#11 behaviour (back-compat)', () => {
        const b: ResultsBlob = { item1: { status: 'satisfactory', notes: 'O', photos: [], updatedAt: 0 } };
        const o: ResultsBlob = { item1: { status: 'satisfactory', notes: 'A', photos: [], updatedAt: 1 } };
        const t: ResultsBlob = { item1: { status: 'satisfactory', notes: 'B', photos: [], updatedAt: 1 } };
        const out = mergeResults(b, o, t);
        expect(out.conflicts).toHaveLength(1);
    });
});
