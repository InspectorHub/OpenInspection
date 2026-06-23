/**
 * Pure Yjs helpers for the inspection results collaborative document.
 *
 * No DB, no I/O — all functions operate on a Y.Doc in memory.
 * A Durable Object will call these helpers to manage the live document state.
 *
 * The three exports implement Condition A of the migration design (#181):
 *   - `seedResultsDoc`  — pre-creates full nested structure so two clients can
 *     never lazily create the same Y.Map and race to overwrite each other.
 *   - `applyItemPatch`  — mutates a single field inside a transaction.
 *   - `projectResults`  — converts the Y.Doc to the exact `inspection_results.data`
 *     JSON shape that existing readers (report service, PDF renderer) consume,
 *     omitting empty optionals so the output matches the legacy blob.
 */

import * as Y from 'yjs';
import type {
    FindingKey,
    ItemEntry,
    ResultsProjection,
    PhotoEntry,
    CannedState,
    DefectState,
} from './results-doc.types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build the fully-formed nested Y.Map structure for one item.
 * Called only when the item is absent from the results map.
 */
function buildItemMap(): Y.Map<unknown> {
    const item = new Y.Map<unknown>();

    // Scalar fields (rating, notes, value) are set lazily via applyItemPatch.

    // attributes: Y.Map — structured property bag (e.g. checkbox fields)
    item.set('attributes', new Y.Map<unknown>());

    // tabs: Y.Map holding three arrays of canned-comment entries
    const tabs = new Y.Map<unknown>();
    tabs.set('information', new Y.Array<unknown>());
    tabs.set('limitations', new Y.Array<unknown>());
    tabs.set('defects', new Y.Array<unknown>());
    item.set('tabs', tabs);

    // photos: Y.Array of photo attachment objects
    item.set('photos', new Y.Array<unknown>());

    return item;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Seed the results doc with a fully-formed nested Y.Map for each item.
 *
 * Idempotent: if the item key already exists in the map it is left untouched,
 * so existing values (rating, notes, etc.) are never clobbered.
 *
 * This satisfies Condition A — the structure is present before any client
 * begins editing, so concurrent writes to different fields of the same item
 * cannot collide on the nested Y.Map identity.
 */
export function seedResultsDoc(
    doc: Y.Doc,
    items: Array<{ findingKey: FindingKey }>,
): void {
    const results = doc.getMap<unknown>('results');

    doc.transact(() => {
        for (const { findingKey } of items) {
            if (results.get(findingKey) !== undefined) {
                // Already seeded — leave it intact.
                continue;
            }
            results.set(findingKey, buildItemMap());
        }
    });
}

/**
 * Apply a single-field patch to an item inside a Y.Doc transaction.
 *
 * The item is expected to have been pre-seeded via `seedResultsDoc`. If it is
 * absent (defensive path), it is seeded first.
 *
 * For scalar fields (`rating`, `notes`, `value`) the value is set directly on
 * the item Y.Map. The `attributes`, `tabs`, and `photos` fields hold nested
 * Yjs structures that are replaced wholesale — callers must pass the full
 * intended state for those fields.
 */
export function applyItemPatch(
    doc: Y.Doc,
    findingKey: FindingKey,
    field: 'rating' | 'notes' | 'value' | 'attributes' | 'tabs' | 'photos',
    value: unknown,
): void {
    const results = doc.getMap<unknown>('results');

    doc.transact(() => {
        // Defensive: seed if somehow absent.
        if (results.get(findingKey) === undefined) {
            results.set(findingKey, buildItemMap());
        }

        const item = results.get(findingKey) as Y.Map<unknown>;
        item.set(field, value);
    });
}

/**
 * Project the Y.Doc to the `inspection_results.data` JSON shape.
 *
 * Empty optionals are omitted so the output equals what the legacy blob
 * stored (no spurious `photos: []` / `tabs: {}` / `attributes: {}` keys).
 * Existing readers — the report service, PDF renderer — rely on this shape
 * and must receive it unchanged.
 */
export function projectResults(doc: Y.Doc): ResultsProjection {
    const results = doc.getMap<unknown>('results');
    const projection: ResultsProjection = {};

    results.forEach((rawItem, findingKey) => {
        if (!(rawItem instanceof Y.Map)) return;

        const entry: ItemEntry = {};

        // ── Scalar fields ────────────────────────────────────────────────────

        const rating = rawItem.get('rating');
        if (typeof rating === 'string' && rating.length > 0) {
            entry.rating = rating;
        }

        const notes = rawItem.get('notes');
        if (typeof notes === 'string' && notes.length > 0) {
            entry.notes = notes;
        }

        const value = rawItem.get('value');
        if (value !== undefined && value !== null) {
            entry.value = value;
        }

        const recommendation = rawItem.get('recommendation');
        if (typeof recommendation === 'string' && recommendation.length > 0) {
            entry.recommendation = recommendation;
        }

        const estimateMin = rawItem.get('estimateMin');
        if (typeof estimateMin === 'number') {
            entry.estimateMin = estimateMin;
        }

        const estimateMax = rawItem.get('estimateMax');
        if (typeof estimateMax === 'number') {
            entry.estimateMax = estimateMax;
        }

        // ── attributes ───────────────────────────────────────────────────────

        const attributesRaw = rawItem.get('attributes');
        if (attributesRaw instanceof Y.Map && attributesRaw.size > 0) {
            entry.attributes = attributesRaw.toJSON() as Record<string, unknown>;
        }

        // ── tabs ─────────────────────────────────────────────────────────────

        const tabsRaw = rawItem.get('tabs');
        if (tabsRaw instanceof Y.Map) {
            const information = tabsRaw.get('information');
            const limitations = tabsRaw.get('limitations');
            const defects     = tabsRaw.get('defects');

            const infoArr = information instanceof Y.Array
                ? (information.toJSON() as CannedState[])
                : [];
            const limArr  = limitations instanceof Y.Array
                ? (limitations.toJSON() as CannedState[])
                : [];
            const defArr  = defects instanceof Y.Array
                ? (defects.toJSON() as DefectState[])
                : [];

            const tabsEntry: ItemEntry['tabs'] = {};
            if (infoArr.length > 0) tabsEntry.information = infoArr;
            if (limArr.length  > 0) tabsEntry.limitations = limArr;
            if (defArr.length  > 0) tabsEntry.defects      = defArr;

            // Only include the tabs key when at least one array is non-empty.
            if (
                infoArr.length > 0 ||
                limArr.length  > 0 ||
                defArr.length  > 0
            ) {
                entry.tabs = tabsEntry;
            }
        }

        // ── photos ───────────────────────────────────────────────────────────

        const photosRaw = rawItem.get('photos');
        if (photosRaw instanceof Y.Array && photosRaw.length > 0) {
            entry.photos = photosRaw.toJSON() as PhotoEntry[];
        }

        // ── re-inspection fields ──────────────────────────────────────────────

        const originalRaw = rawItem.get('original');
        if (originalRaw instanceof Y.Map) {
            const orig: ItemEntry['original'] = {};
            const origRating = originalRaw.get('rating');
            const origNotes  = originalRaw.get('notes');
            const origPhotos = originalRaw.get('photos');

            if (origRating !== undefined) orig.rating = origRating as string | null;
            if (origNotes  !== undefined) orig.notes  = origNotes  as string | null;
            if (origPhotos instanceof Y.Array && origPhotos.length > 0) {
                orig.photos = origPhotos.toJSON() as PhotoEntry[];
            }
            entry.original = orig;
        }

        const followupStatus = rawItem.get('followupStatus');
        if (followupStatus !== undefined) {
            entry.followupStatus = followupStatus as string | null;
        }

        const followupNotes = rawItem.get('followupNotes');
        if (followupNotes !== undefined) {
            entry.followupNotes = followupNotes as string | null;
        }

        projection[findingKey] = entry;
    });

    return projection;
}
