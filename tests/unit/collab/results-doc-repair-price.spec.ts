/**
 * A finding carries no repair price, and the collaborative document is where
 * that has to be true.
 *
 * The editor writes findings through a Yjs CRDT, not through a request body.
 * There is no schema to refuse at that boundary: a client sends a binary
 * `Y.applyUpdate` and the Durable Object merges it, so any key a caller invents
 * lands in the doc. The only place the product decides what a finding IS, is
 * `projectResults` — the function that turns the doc into the
 * `inspection_results.data` row every reader downstream trusts.
 *
 * So these tests put the money in the doc BY HAND (bypassing every typed
 * mutator, exactly as a hand-crafted client would) and assert it does not come
 * back out. A test that only used the typed API would pass the moment the TS
 * field was deleted, while the transport that actually carries the write kept
 * working — vacuously green about the one path that is reachable.
 *
 * Every fixture below carries a NON-ZERO amount, and each test first asserts
 * the amount really is in the doc. "Not in the output" is trivially true of an
 * input that never had it.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
    seedResultsDoc,
    projectResults,
    loadResultsProjection,
    upsertCanned,
} from '../../../server/lib/collab/results-doc';
import type { ResultsProjection } from '../../../server/lib/collab/results-doc.types';

const FK = '_default:s1:i1';

/** What a hand-crafted collab client can do: write any key into the item map. */
function rawItem(doc: Y.Doc): Y.Map<unknown> {
    return doc.getMap('results').get(FK) as Y.Map<unknown>;
}

describe('results-doc — a finding carries no repair price', () => {
    it('drops an item-level estimateMin/estimateMax written straight into the Y.Map', () => {
        const doc = new Y.Doc();
        seedResultsDoc(doc, [{ findingKey: FK }]);
        doc.transact(() => {
            rawItem(doc).set('estimateMin', 250000);
            rawItem(doc).set('estimateMax', 900000);
            rawItem(doc).set('rating', 'Defect');
        });

        // The doc really does hold the money — otherwise the assertion below
        // would pass against an empty input.
        expect(rawItem(doc).get('estimateMin')).toBe(250000);
        expect(rawItem(doc).get('estimateMax')).toBe(900000);

        const proj = projectResults(doc);
        expect(Object.keys(proj[FK]!)).not.toContain('estimateMin');
        expect(Object.keys(proj[FK]!)).not.toContain('estimateMax');
        // Not achieved by projecting nothing.
        expect(proj[FK]!.rating).toBe('Defect');
    });

    it('drops estimateLow/estimateHigh from a canned defect entry', () => {
        const doc = new Y.Doc();
        seedResultsDoc(doc, [{ findingKey: FK }]);
        upsertCanned(doc, FK, 'defects', {
            cannedId: 'def-1',
            included: true,
            location: 'north slope',
            ...({ estimateLow: 50000, estimateHigh: 150000 } as object),
        });

        const defects = (rawItem(doc).get('tabs') as Y.Map<unknown>).get('defects') as Y.Array<unknown>;
        const stored = (defects.get(0) as Y.Map<unknown>);
        expect(stored.get('estimateLow')).toBe(50000);
        expect(stored.get('estimateHigh')).toBe(150000);

        const projected = projectResults(doc)[FK]!.tabs!.defects!;
        expect(projected).toHaveLength(1);
        const keys = Object.keys(projected[0]!);
        expect(keys).not.toContain('estimateLow');
        expect(keys).not.toContain('estimateHigh');
        // The defect itself survives — the price is what is removed, not the row.
        expect(projected[0]!.cannedId).toBe('def-1');
        expect(projected[0]!.location).toBe('north slope');
    });

    it('does not re-hydrate a price out of a legacy stored blob', () => {
        // A row written before repair pricing was withdrawn. Loading it into a
        // fresh doc must not put the figure back into circulation — that is the
        // route by which a retired capability quietly resumes.
        const legacy = {
            [FK]: {
                rating: 'Defect',
                estimateMin: 111100,
                estimateMax: 222200,
                tabs: {
                    defects: [
                        { cannedId: 'def-1', included: true, estimateLow: 50000, estimateHigh: 150000 },
                    ],
                },
            },
        } as unknown as ResultsProjection;

        // The fixture carries money.
        expect(JSON.stringify(legacy)).toContain('111100');
        expect(JSON.stringify(legacy)).toContain('50000');

        const doc = new Y.Doc();
        loadResultsProjection(doc, legacy);

        const out = projectResults(doc);
        expect(out[FK]!.rating).toBe('Defect');
        const serialized = JSON.stringify(out);
        expect(serialized).not.toContain('111100');
        expect(serialized).not.toContain('222200');
        expect(serialized).not.toContain('50000');
        expect(serialized).not.toContain('150000');
    });
});
