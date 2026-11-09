// @vitest-environment node
/**
 * Two INDEPENDENT Yjs lineages of the same inspection merged into one doc.
 *
 * A lineage is the history one server document grew from. A new one begins
 * whenever the server document is rebuilt from the stored results (storage
 * emptied, a version restore, a rebuild from the database) rather than carried
 * forward. A browser that kept the old lineage in its offline store and later
 * reconnects hands that history back; Yjs merges the two as a union.
 *
 * Both lineages create the same `results[findingKey]` item map. Concurrent writes
 * to one map key are decided by client id, not by time, so the WHOLE item of one
 * lineage replaces the other's, at random per key.
 *
 * This is the characterization of WHY the connection carries a lineage guard (see
 * `collab/results-doc-lineage.ts` and its tests): Yjs itself cannot reconcile two lineages, so a
 * client must never hand one back to a server holding the other.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { appendPhoto, loadResultsProjection, projectResults, removePhoto, seedResultsDoc } from './results-doc';

const photo = (key: string) => ({ key, mediaType: 'image' }) as never;

function oldLineage(clientID: number): Y.Doc {
    const d = new Y.Doc();
    d.clientID = clientID;
    seedResultsDoc(d, [{ findingKey: 'kitchen' }]);
    appendPhoto(d, 'kitchen', photo('K1'));
    appendPhoto(d, 'kitchen', photo('N1'));
    appendPhoto(d, 'kitchen', photo('N2'));
    return d;
}

/** The server's newer truth, rebuilt from the stored results blob (a new lineage). */
function newLineage(clientID: number): Y.Doc {
    const d = new Y.Doc();
    d.clientID = clientID;
    loadResultsProjection(d, { kitchen: { photos: [photo('K1'), photo('K3'), photo('A5')] } } as never);
    return d;
}

const keys = (d: Y.Doc) => (projectResults(d).kitchen?.photos ?? []).map((p) => p.key);

describe('independent lineages merged (stale offline store)', () => {
    for (const [label, oldId, newId] of [['old lineage has the higher client id', 900, 100], ['new lineage has the higher client id', 100, 900]] as const) {
        it(`${label}: exactly one lineage's photo list survives, chosen by client id`, () => {
            const live = newLineage(newId);
            Y.applyUpdate(live, Y.encodeStateAsUpdate(oldLineage(oldId)));
            const result = keys(live);
            // Converges identically both ways (the stale side also adopts the server's state).
            const stale = oldLineage(oldId);
            Y.applyUpdate(stale, Y.encodeStateAsUpdate(newLineage(newId)));
            expect(keys(stale)).toEqual(result);
            // Never a union and never newest-wins: it is one list or the other.
            expect([['K1', 'K3', 'A5'], ['K1', 'N1', 'N2']]).toContainEqual(result);
        });
    }

    it('the winner is the old lineage when its client id is higher (stale photos resurrected)', () => {
        const live = newLineage(100);
        removePhoto(live, 'kitchen', 'A5');
        Y.applyUpdate(live, Y.encodeStateAsUpdate(oldLineage(900)));
        expect(keys(live)).toEqual(['K1', 'N1', 'N2']);
    });
});
