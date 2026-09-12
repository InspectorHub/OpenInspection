import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { loadResultsProjection, projectResults } from '../../../server/lib/collab/results-doc';
import { applyFollowupPatch, resolveCarriedFindingKey } from '../../../server/lib/collab/followup-patch';
import type { ResultsProjection } from '../../../server/lib/collab/results-doc.types';

/**
 * F45 — the write the re-inspection feature was missing.
 *
 * `createReinspection` seeds every carried item as `{ original, followupStatus:
 * null }`, the report reads `followupStatus` verbatim and the NEXT round's
 * pre-selection is computed from it. No surface could set it: the field had zero
 * writers outside the version-history recover path. These specs hold the
 * document-level half — resolution from an item id, and the patch itself.
 */
const CARRIED = '_default:roof:chimney';
const PLAIN = '_default:roof:flashing';

function docWith(projection: ResultsProjection): Y.Doc {
    const doc = new Y.Doc();
    loadResultsProjection(doc, projection);
    return doc;
}

const carriedRound: ResultsProjection = {
    [CARRIED]: { original: { rating: 'Defect', notes: 'Cracked crown' }, followupStatus: null },
    [PLAIN]: { rating: 'Satisfactory' },
};

describe('resolveCarriedFindingKey', () => {
    it('finds the one carried finding an item id names', () => {
        const resolved = resolveCarriedFindingKey(docWith(carriedRound), 'chimney');
        expect(resolved).toEqual({ ok: true, findingKey: CARRIED });
    });

    it('refuses an item that was never carried forward', () => {
        // `flashing` exists in the document and has a rating, so this is not a
        // "key not found" — it is the narrowing that stops a follow-up verdict
        // being attached to an item with no baseline to follow up on.
        expect(resolveCarriedFindingKey(docWith(carriedRound), 'flashing'))
            .toEqual({ ok: false, reason: 'not-carried' });
        expect(resolveCarriedFindingKey(docWith(carriedRound), 'nothing-like-this'))
            .toEqual({ ok: false, reason: 'not-carried' });
    });

    it('reports ambiguity rather than picking a unit', () => {
        // A multi-unit baseline can carry the same item id under two units.
        // Choosing either would record the inspector's verdict against the wrong
        // unit, which is worse than refusing.
        const twoUnits = docWith({
            'unit-1:roof:chimney': { original: { rating: 'Defect' }, followupStatus: null },
            'unit-2:roof:chimney': { original: { rating: 'Defect' }, followupStatus: null },
        });
        expect(resolveCarriedFindingKey(twoUnits, 'chimney'))
            .toEqual({ ok: false, reason: 'ambiguous' });
    });
});

describe('applyFollowupPatch', () => {
    it('writes the verdict where the report reads it', () => {
        const doc = docWith(carriedRound);
        applyFollowupPatch(doc, CARRIED, { status: 'resolved' });
        const out = projectResults(doc);
        expect(out[CARRIED]?.followupStatus).toBe('resolved');
        // The baseline is untouched — the whole point of the left/right report
        // layout is that the original finding survives the follow-up.
        expect(out[CARRIED]?.original?.notes).toBe('Cracked crown');
    });

    it('leaves the note alone when no note is supplied', () => {
        const doc = docWith({
            [CARRIED]: { original: { rating: 'Defect' }, followupStatus: null, followupNotes: 'Crown re-sealed' },
        });
        applyFollowupPatch(doc, CARRIED, { status: 'resolved' });
        expect(projectResults(doc)[CARRIED]?.followupNotes).toBe('Crown re-sealed');
    });

    it('records a note when one IS supplied, and can clear it', () => {
        const doc = docWith(carriedRound);
        applyFollowupPatch(doc, CARRIED, { status: 'not_resolved', notes: 'Still open at the flue' });
        expect(projectResults(doc)[CARRIED]?.followupNotes).toBe('Still open at the flue');
        applyFollowupPatch(doc, CARRIED, { status: 'not_resolved', notes: '' });
        expect(projectResults(doc)[CARRIED]?.followupNotes).toBe('');
    });

    it('can take a verdict BACK to "nothing recorded"', () => {
        // Null is the state a carried item starts in and the state `isOpenStatus`
        // reads as still open, so an inspector who mis-clicked has to be able to
        // reach it again.
        const doc = docWith(carriedRound);
        applyFollowupPatch(doc, CARRIED, { status: 'resolved' });
        applyFollowupPatch(doc, CARRIED, { status: null });
        expect(projectResults(doc)[CARRIED]?.followupStatus).toBeNull();
    });
});
