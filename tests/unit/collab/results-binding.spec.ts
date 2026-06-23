import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
    readResultMap,
    bindResultMap,
    setRating,
    setNotes,
    setValue,
    setItemAttribute,
    toggleCanned,
    setDefectFields,
    appendPhoto,
    addCustomDefect,
    attachRepairItem,
} from '../../../app/lib/collab/results-binding';

// ─── Group 1: Round-trip scalar ───────────────────────────────────────────────

describe('results-binding – round-trip scalar', () => {
    it('setRating stores the rating under both composite and bare keys', () => {
        const doc = new Y.Doc();

        setRating(doc, 's1', 'i1', 'NI');

        const map = readResultMap(doc);

        // Composite key present with the correct rating.
        expect(map['_default:s1:i1']).toBeDefined();
        expect(map['_default:s1:i1'].rating).toBe('NI');

        // Bare itemId key present and is the same object reference.
        expect(map['i1']).toBeDefined();
        expect(map['i1'].rating).toBe('NI');

        // Same reference (dual-key invariant).
        expect(map['_default:s1:i1']).toBe(map['i1']);
    });

    it('setNotes and setValue round-trip under both keys', () => {
        const doc = new Y.Doc();

        setNotes(doc, 's1', 'i1', 'cracked pipe');
        setValue(doc, 's1', 'i1', 42);

        const map = readResultMap(doc);

        expect(map['_default:s1:i1'].notes).toBe('cracked pipe');
        expect(map['i1'].notes).toBe('cracked pipe');

        expect(map['_default:s1:i1'].value).toBe(42);
        expect(map['i1'].value).toBe(42);
    });
});

// ─── Group 2: Round-trip nested ───────────────────────────────────────────────

describe('results-binding – round-trip nested', () => {
    it('reflects canned defect, photo, custom defect, and repair item under composite key', () => {
        const doc = new Y.Doc();

        toggleCanned(doc, 's1', 'i1', 'defects', 'd1', true);
        setDefectFields(doc, 's1', 'i1', 'd1', { location: 'North wall' });
        appendPhoto(doc, 's1', 'i1', { key: 'r2/a.jpg' });
        addCustomDefect(doc, 's1', 'i1', {
            id: 'c1',
            title: 'X',
            comment: 'y',
            included: true,
        });
        attachRepairItem(doc, 's1', 'i1', {
            recommendationId: 'r1',
            estimateSnapshotMin: 100,
            estimateSnapshotMax: 200,
            summarySnapshot: 'fix',
            contractorTypeSnapshot: null,
            attachedAt: 1,
        });

        const map = readResultMap(doc);
        const entry = map['_default:s1:i1'];

        expect(entry).toBeDefined();

        // Canned defect tabs.
        const tabs = entry.tabs as {
            defects?: Array<{ cannedId: string; included: boolean; location?: string }>;
        };
        expect(tabs?.defects).toBeDefined();
        const defect = tabs?.defects?.find((d) => d.cannedId === 'd1');
        expect(defect).toBeDefined();
        expect(defect?.included).toBe(true);
        expect(defect?.location).toBe('North wall');

        // Photos.
        const photos = entry.photos as Array<{ key: string }> | undefined;
        expect(photos).toBeDefined();
        expect(photos?.some((p) => p.key === 'r2/a.jpg')).toBe(true);

        // Custom defects.
        const customComments = entry.customComments as {
            defects?: Array<{ id: string; title: string }>;
        };
        expect(customComments?.defects).toBeDefined();
        expect(customComments?.defects?.some((c) => c.id === 'c1')).toBe(true);

        // Repair items.
        const recommendations = entry.recommendations as Array<{
            recommendationId: string;
            estimateSnapshotMin: number;
        }> | undefined;
        expect(recommendations).toBeDefined();
        const rec = recommendations?.find((r) => r.recommendationId === 'r1');
        expect(rec).toBeDefined();
        expect(rec?.estimateSnapshotMin).toBe(100);
    });

    it('setItemAttribute is reflected in the entry attributes object', () => {
        const doc = new Y.Doc();

        setItemAttribute(doc, 's1', 'i1', 'checkboxA', true);

        const map = readResultMap(doc);
        const entry = map['_default:s1:i1'];

        expect(entry).toBeDefined();
        const attrs = entry.attributes as Record<string, unknown> | undefined;
        expect(attrs).toBeDefined();
        expect(attrs?.checkboxA).toBe(true);
    });
});

// ─── Group 3: bindResultMap fires on remote-style update ─────────────────────

describe('results-binding – bindResultMap', () => {
    it('fires onChange when a remote update is applied and stops after unsubscribe', () => {
        const doc = new Y.Doc();
        const other = new Y.Doc();

        // Set a rating on the other doc (simulates a remote peer).
        setRating(other, 's2', 'i2', 'IN');

        const onChange = vi.fn<(next: ReturnType<typeof readResultMap>) => void>();
        const unsubscribe = bindResultMap(doc, onChange);

        // Apply the remote state to our doc.
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));

        expect(onChange).toHaveBeenCalledOnce();
        const latestMap = onChange.mock.calls[0][0];
        expect(latestMap['_default:s2:i2']?.rating).toBe('IN');

        // Unsubscribe — further updates must not trigger the handler.
        unsubscribe();
        onChange.mockClear();

        const third = new Y.Doc();
        setRating(third, 's3', 'i3', 'D');
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(third));

        expect(onChange).not.toHaveBeenCalled();
    });

    it('emits the current snapshot immediately when a write occurs via helpers', () => {
        const doc = new Y.Doc();
        const onChange = vi.fn<(next: ReturnType<typeof readResultMap>) => void>();
        bindResultMap(doc, onChange);

        setNotes(doc, 's1', 'i1', 'hello');

        expect(onChange).toHaveBeenCalled();
        const latestMap = onChange.mock.lastCall?.[0];
        expect(latestMap?.['_default:s1:i1']?.notes).toBe('hello');
    });
});

// ─── Group 4: Read model matches editor accessor shape (dual-key invariant) ───

describe('results-binding – dual-key invariant', () => {
    it('bare itemId entry equals the composite key entry (same reference)', () => {
        const doc = new Y.Doc();

        setRating(doc, 's1', 'i1', 'D');
        appendPhoto(doc, 's1', 'i1', { key: 'r2/b.jpg' });

        const map = readResultMap(doc);

        // Both keys must be defined.
        expect(map['_default:s1:i1']).toBeDefined();
        expect(map['i1']).toBeDefined();

        // Same object reference — dual-key invariant.
        expect(map['_default:s1:i1']).toBe(map['i1']);

        // The data is the same under both keys.
        expect((map['i1'].photos as Array<{ key: string }>)?.[0]?.key).toBe('r2/b.jpg');
    });

    it('two different items do not bleed into each other', () => {
        const doc = new Y.Doc();

        setRating(doc, 's1', 'i1', 'NI');
        setRating(doc, 's1', 'i2', 'IN');

        const map = readResultMap(doc);

        expect(map['_default:s1:i1'].rating).toBe('NI');
        expect(map['i1'].rating).toBe('NI');

        expect(map['_default:s1:i2'].rating).toBe('IN');
        expect(map['i2'].rating).toBe('IN');

        // Cross-check: item keys do not bleed.
        expect(map['i1'].rating).not.toBe(map['i2'].rating);
    });
});
