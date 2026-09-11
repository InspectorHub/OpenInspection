/**
 * #119 — writing a re-inspection's follow-up disposition into the live results
 * document.
 *
 * WHY THIS IS A SERVER-SIDE PATCH AND NOT A CLIENT ONE. Collaboration is the
 * only write path for a finding (see `useFindings`): a value written straight to
 * `inspection_results.data` is erased by the next flush of the Y.Doc, which
 * knows nothing about it. The document lives in the Durable Object, so the
 * honest road from a form submission to `followupStatus` is route → DO → here →
 * `applyItemPatch`, after which the DO's own update listener broadcasts the
 * change to every connected editor and schedules the D1 projection write. The
 * inspector sees their own answer arrive the same way a collaborator's would.
 *
 * The field itself is not new. `createReinspection` seeds every carried item as
 * `{ original, followupStatus: null }`, the report service reads
 * `followupStatus` / `followupNotes` verbatim, and `getReinspectCandidates`
 * decides what the NEXT round pre-selects from it. What was missing was any way
 * for a human to set it — the one field the whole feature exists to collect.
 */
import * as Y from 'yjs';
import { applyItemPatch } from './results-doc';
import type { FindingKey } from './results-doc.types';

export type CarriedKeyResolution =
    | { ok: true; findingKey: FindingKey }
    | { ok: false; reason: 'not-carried' | 'ambiguous' };

/**
 * Which finding key an `itemId` names, among the items this round CARRIED.
 *
 * The caller has an item id and not a composite key, because the editor panel
 * that collects the disposition knows the item it is rendering and not the
 * unit/section coordinates the key is built from. Resolution happens here, in
 * front of the document, rather than being guessed anywhere else.
 *
 * Two narrowings make it safe. The key's last segment must be the item id (a
 * legacy bare-id key is matched whole), and the entry must already carry an
 * `original` — which only the re-inspection seeding writes. So a follow-up
 * status can never be attached to an item that was not carried forward.
 *
 * `ambiguous` is a real answer, not a defensive stub: a multi-unit baseline can
 * carry the same item id under two units, and choosing one of them would record
 * the inspector's verdict against the wrong unit. It is reported, never picked.
 */
export function resolveCarriedFindingKey(doc: Y.Doc, itemId: string): CarriedKeyResolution {
    const results = doc.getMap<unknown>('results');
    const matches: FindingKey[] = [];

    for (const key of results.keys()) {
        const tail = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key;
        if (tail !== itemId) continue;
        const entry = results.get(key);
        if (!(entry instanceof Y.Map)) continue;
        // `original` is written by createReinspection's seeding and by
        // loadResultsProjection's re-hydration of it; nothing else sets it.
        if (entry.get('original') === undefined) continue;
        matches.push(key);
    }

    if (matches.length === 0) return { ok: false, reason: 'not-carried' };
    if (matches.length > 1) return { ok: false, reason: 'ambiguous' };
    return { ok: true, findingKey: matches[0] as FindingKey };
}

/**
 * Write the disposition (and optionally the inspector's note on it).
 *
 * `status` may be null — that is "no conclusion recorded yet", the state a
 * carried item starts in and the state `isOpenStatus` reads as still open, so
 * clearing an answer has to be expressible. `notes` is only touched when the
 * caller supplies it, so recording a status does not wipe a note.
 */
export function applyFollowupPatch(
    doc: Y.Doc,
    findingKey: FindingKey,
    patch: { status: string | null; notes?: string | null },
): void {
    applyItemPatch(doc, findingKey, 'followupStatus', patch.status);
    if (patch.notes !== undefined) {
        applyItemPatch(doc, findingKey, 'followupNotes', patch.notes);
    }
}
