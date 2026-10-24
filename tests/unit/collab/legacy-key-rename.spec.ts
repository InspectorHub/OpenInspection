/**
 * Renaming legacy (bare item id) finding keys inside the live results document.
 *
 * Real Y.Docs, no stubs. The Durable Object verb that wraps this runs in workerd
 * in tests/workers/collab-legacy-key-rename.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
    loadResultsProjection, projectResults, seedResultsDoc, applyItemPatch, upsertCanned,
} from '@core/field-ui/shared/results-doc';
import type { ResultsProjection } from '@core/field-ui/shared/results-doc.types';
import { hasRenamableLegacyKeys, itemSectionsFromSnapshot, renameLegacyFindingKeys } from '../../../server/lib/collab/legacy-key-rename';

const SECTIONS = new Map<string, string[]>([['roof', ['s1']], ['attic', ['s1']], ['shared', ['s1', 's2']]]);
const COMPOSITE = '_default:s1:roof';

/** An item carrying one of every field type the editor stores. */
const FULL_ITEM: ResultsProjection[string] = {
    rating: 'D',
    notes: 'Flashing lifted at the ridge',
    value: { reading: 12 },
    recommendation: 'Re-flash',
    attributes: { material: 'asphalt', layers: 2 },
    photos: [{ key: 't/p1.jpg', annotatedKey: 't/p1-a.png' }, { key: 't/p2.jpg' }],
    tabs: {
        information: [{ cannedId: 'c-info', included: true, comment: 'Seen from the ground' }],
        limitations: [{ cannedId: 'c-lim', included: true }],
        defects: [{ cannedId: 'c-def', included: true, category: 'safety', location: 'north slope', photos: [{ key: 't/d.jpg' }] }],
    },
    customComments: {
        information: [{ id: 'cc1', title: 'Note', comment: 'Extra', included: true }],
        defects: [{ id: 'cc2', title: 'Crack', comment: 'Hairline', included: true, photos: [{ key: 't/cc.jpg' }] }],
    },
    recommendations: [{ recommendationId: 'r1', summarySnapshot: 'Re-flash', contractorTypeSnapshot: 'roofer', attachedAt: 1 }],
    original: { rating: 'S', notes: 'last time', photos: [{ key: 't/o.jpg' }] },
    followupStatus: 'open',
    followupNotes: 'check again',
};

/** The state a document is in after hydration: bare-keyed content, composite items seeded empty. */
function legacyDoc(items: ResultsProjection = { roof: FULL_ITEM }): Y.Doc {
    const doc = new Y.Doc();
    loadResultsProjection(doc, items);
    seedResultsDoc(doc, [{ findingKey: COMPOSITE }, { findingKey: '_default:s1:attic' }]);
    return doc;
}

const results = (doc: Y.Doc) => doc.getMap<unknown>('results');

describe('renameLegacyFindingKeys', () => {
    it('moves the content onto the composite key, as the legacy item projected, and drops the bare key', () => {
        const doc = legacyDoc();
        const before = projectResults(doc).roof;
        expect(before).toEqual(FULL_ITEM);

        const counts = renameLegacyFindingKeys(doc, SECTIONS);

        expect(counts).toEqual({ renamed: 1, skippedMeta: 0, skippedUnknown: 0, skippedAmbiguous: 0, conflicts: 0 });
        const after = projectResults(doc);
        expect(after[COMPOSITE]).toEqual(before);
        expect('roof' in after).toBe(false);
        expect(results(doc).has('roof')).toBe(false);
    });

    it('copies fields the projection does not cover, because it copies the item map and not the projection', () => {
        const doc = legacyDoc();
        const legacy = results(doc).get('roof') as Y.Map<unknown>;
        legacy.set('estimateMin', 100);
        legacy.set('somethingNew', { nested: ['x'] });
        expect(projectResults(doc)[COMPOSITE]).toEqual({});

        renameLegacyFindingKeys(doc, SECTIONS);

        const target = results(doc).get(COMPOSITE) as Y.Map<unknown>;
        expect(target.get('estimateMin')).toBe(100);
        expect(target.get('somethingNew')).toEqual({ nested: ['x'] });
    });

    it('keeps containers as containers, so the editor can still edit them in place', () => {
        const doc = legacyDoc();
        renameLegacyFindingKeys(doc, SECTIONS);
        const target = results(doc).get(COMPOSITE) as Y.Map<unknown>;
        expect(target.get('photos')).toBeInstanceOf(Y.Array);
        expect((target.get('photos') as Y.Array<unknown>).get(0)).toBeInstanceOf(Y.Map);
        expect((target.get('tabs') as Y.Map<unknown>).get('defects')).toBeInstanceOf(Y.Array);

        applyItemPatch(doc, COMPOSITE, 'rating', 'S');
        expect(projectResults(doc)[COMPOSITE]?.rating).toBe('S');
    });

    it('creates the composite item when the document had none', () => {
        const doc = new Y.Doc();
        loadResultsProjection(doc, { roof: FULL_ITEM });
        renameLegacyFindingKeys(doc, SECTIONS);
        expect(projectResults(doc)).toEqual({ [COMPOSITE]: FULL_ITEM });
    });

    it('never overwrites a composite field that has content, keeps it, and counts the conflict', () => {
        const doc = legacyDoc({ roof: { rating: 'D', notes: 'legacy note', followupStatus: 'open' } });
        applyItemPatch(doc, COMPOSITE, 'notes', 'composite note');

        const counts = renameLegacyFindingKeys(doc, SECTIONS);

        const item = projectResults(doc)[COMPOSITE];
        expect(item?.notes).toBe('composite note');
        expect(item?.rating).toBe('D');
        expect(item?.followupStatus).toBe('open');
        expect(counts).toMatchObject({ renamed: 1, conflicts: 1 });
    });

    it('does not call identical content a conflict', () => {
        const doc = legacyDoc({ roof: { notes: 'same' } });
        applyItemPatch(doc, COMPOSITE, 'notes', 'same');
        expect(renameLegacyFindingKeys(doc, SECTIONS).conflicts).toBe(0);
    });

    it('merges nested maps by sub-field, so a legacy tab survives next to a composite one', () => {
        const doc = legacyDoc({ roof: { tabs: { defects: [{ cannedId: 'legacy-def', included: true }] } } });
        upsertCanned(doc, COMPOSITE, 'information', { cannedId: 'composite-info', included: true });

        const counts = renameLegacyFindingKeys(doc, SECTIONS);

        const tabs = projectResults(doc)[COMPOSITE]?.tabs;
        expect(tabs?.information).toEqual([{ cannedId: 'composite-info', included: true }]);
        expect(tabs?.defects).toEqual([{ cannedId: 'legacy-def', included: true }]);
        expect(counts.conflicts).toBe(0);
    });

    it('unions arrays instead of choosing a side, deduplicated by content, composite elements first', () => {
        const doc = legacyDoc({
            roof: {
                photos: [{ key: 'shared.jpg' }, { key: 'legacy-only.jpg' }],
                tabs: { defects: [{ cannedId: 'd1', included: true }, { cannedId: 'd2', included: true }] },
                customComments: { information: [{ id: 'cc1', title: 'T', comment: 'legacy', included: true }] },
            },
        });
        applyItemPatch(doc, COMPOSITE, 'rating', 'S');
        (results(doc).get(COMPOSITE) as Y.Map<unknown>).set('photos', (() => {
            const arr = new Y.Array<unknown>();
            const a = new Y.Map<unknown>(); a.set('key', 'composite-only.jpg');
            const b = new Y.Map<unknown>(); b.set('key', 'shared.jpg');
            arr.push([a, b]);
            return arr;
        })());
        upsertCanned(doc, COMPOSITE, 'defects', { cannedId: 'd1', included: true });

        const counts = renameLegacyFindingKeys(doc, SECTIONS);

        const item = projectResults(doc)[COMPOSITE];
        expect(item?.photos?.map((p) => p.key)).toEqual(['composite-only.jpg', 'shared.jpg', 'legacy-only.jpg']);
        expect(item?.tabs?.defects?.map((d) => d.cannedId)).toEqual(['d1', 'd2']);
        expect(item?.customComments?.information).toHaveLength(1);
        expect(item?.rating).toBe('S');
        expect(counts.conflicts).toBe(0);
    });

    it('reports whether a rename would move anything, without moving it', () => {
        const doc = legacyDoc();
        expect(hasRenamableLegacyKeys(doc, SECTIONS)).toBe(true);
        expect(results(doc).has('roof')).toBe(true);
        renameLegacyFindingKeys(doc, SECTIONS);
        expect(hasRenamableLegacyKeys(doc, SECTIONS)).toBe(false);
        expect(hasRenamableLegacyKeys(legacyDoc({ _inspector_signature: { signatureBase64: 'x' } as never, gone: { rating: 'S' }, shared: { rating: 'I' } }), SECTIONS)).toBe(false);
    });

    it('leaves meta keys, unknown ids, ambiguous ids and composite keys alone, and counts the first three', () => {
        const doc = legacyDoc({
            roof: { rating: 'D' },
            gone: { rating: 'S' },
            shared: { rating: 'I' },
            [COMPOSITE.replace('roof', 'attic')]: { notes: 'already composite' },
        });
        // A stored document from before meta keys were skipped on import: an item map under a meta key.
        const meta = new Y.Map<unknown>();
        meta.set('signatureBase64', 'x');
        results(doc).set('_inspector_signature', meta);
        const untouched = (key: string) => JSON.stringify((results(doc).get(key) as Y.Map<unknown>).toJSON());
        const before = { meta: untouched('_inspector_signature'), gone: untouched('gone'), shared: untouched('shared') };

        const counts = renameLegacyFindingKeys(doc, SECTIONS);

        expect(counts).toEqual({ renamed: 1, skippedMeta: 1, skippedUnknown: 1, skippedAmbiguous: 1, conflicts: 0 });
        expect({ meta: untouched('_inspector_signature'), gone: untouched('gone'), shared: untouched('shared') }).toEqual(before);
        expect(projectResults(doc)['_default:s1:attic']?.notes).toBe('already composite');
        expect(results(doc).has('roof')).toBe(false);
    });

    it('is idempotent: a second run changes nothing', () => {
        const doc = legacyDoc();
        renameLegacyFindingKeys(doc, SECTIONS);
        const settled = projectResults(doc);
        let updates = 0;
        doc.on('update', () => { updates += 1; });

        const again = renameLegacyFindingKeys(doc, SECTIONS);

        expect(again.renamed).toBe(0);
        expect(again.conflicts).toBe(0);
        expect(projectResults(doc)).toEqual(settled);
        expect(updates).toBe(0);
    });

    it('does all of it in ONE transaction, so a client never sees half a rename', () => {
        const doc = legacyDoc({ roof: FULL_ITEM, attic: { rating: 'S' } });
        let updates = 0;
        doc.on('update', () => { updates += 1; });
        expect(renameLegacyFindingKeys(doc, SECTIONS).renamed).toBe(2);
        expect(updates).toBe(1);
    });

    it('converges on a peer that already holds the legacy state', () => {
        const doc = legacyDoc();
        const peer = new Y.Doc();
        Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
        const state = Y.encodeStateVector(peer);

        renameLegacyFindingKeys(doc, SECTIONS);
        Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc, state));

        expect(projectResults(peer)).toEqual(projectResults(doc));
        expect(results(peer).has('roof')).toBe(false);
    });
});

describe('itemSectionsFromSnapshot', () => {
    it('maps each item id to the distinct sections that hold it', () => {
        const map = itemSectionsFromSnapshot({
            sections: [
                { id: 's1', items: [{ id: 'roof' }, { id: 'shared' }, { id: 'roof' }] },
                { id: 's2', items: [{ id: 'shared' }] },
            ],
        });
        expect(map.get('roof')).toEqual(['s1']);
        expect(map.get('shared')).toEqual(['s1', 's2']);
    });

    it('reads a JSON string and a flat legacy array, and returns nothing for garbage', () => {
        expect(itemSectionsFromSnapshot(JSON.stringify({ sections: [{ id: 's1', items: [{ id: 'a' }] }] })).get('a')).toEqual(['s1']);
        expect(itemSectionsFromSnapshot([{ id: 'a' }]).get('a')).toEqual(['general']);
        expect(itemSectionsFromSnapshot(null).size).toBe(0);
        expect(itemSectionsFromSnapshot('not json').size).toBe(0);
    });
});
