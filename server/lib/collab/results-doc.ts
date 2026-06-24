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
    RepairItemSnapshot,
    CustomCommentEntry,
} from './results-doc.types';

type CannedTab = 'information' | 'limitations' | 'defects';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build the fully-formed nested Y.Map structure for one item.
 * Called only when the item is absent from the results map.
 *
 * Every top-level collection is a real Yjs container so concurrent edits to the
 * same item merge with no loss. Scalar fields (rating, notes, value, …) remain
 * lazy — they are set on demand via applyItemPatch.
 */
function buildItemMap(): Y.Map<unknown> {
    const item = new Y.Map<unknown>();

    // attributes: Y.Map — structured property bag (e.g. checkbox fields)
    item.set('attributes', new Y.Map<unknown>());

    // tabs: Y.Map holding three arrays of canned-comment entries
    const tabs = new Y.Map<unknown>();
    tabs.set('information', new Y.Array<unknown>());
    tabs.set('limitations', new Y.Array<unknown>());
    tabs.set('defects', new Y.Array<unknown>());
    item.set('tabs', tabs);

    // photos: Y.Array of photo attachment Y.Maps
    item.set('photos', new Y.Array<unknown>());

    // recommendations: Y.Array of attached repair-item snapshot Y.Maps
    item.set('recommendations', new Y.Array<unknown>());

    // customComments: Y.Map holding three arrays of custom-comment Y.Maps
    const customComments = new Y.Map<unknown>();
    customComments.set('information', new Y.Array<unknown>());
    customComments.set('limitations', new Y.Array<unknown>());
    customComments.set('defects', new Y.Array<unknown>());
    item.set('customComments', customComments);

    return item;
}

/** Get the item Y.Map for `findingKey`, seeding it first if absent. */
function getOrSeedItem(
    results: Y.Map<unknown>,
    findingKey: FindingKey,
): Y.Map<unknown> {
    if (results.get(findingKey) === undefined) {
        results.set(findingKey, buildItemMap());
    }
    return results.get(findingKey) as Y.Map<unknown>;
}

/**
 * Get a nested Y.Array on the item, tolerating items that were seeded by an
 * older buildItemMap (defensive — the field is created if absent).
 */
function getOrCreateArray(parent: Y.Map<unknown>, key: string): Y.Array<unknown> {
    const existing = parent.get(key);
    if (existing instanceof Y.Array) return existing;
    const arr = new Y.Array<unknown>();
    parent.set(key, arr);
    return arr;
}

/** Get a nested Y.Map on the item, creating it if absent. */
function getOrCreateMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
    const existing = parent.get(key);
    if (existing instanceof Y.Map) return existing;
    const map = new Y.Map<unknown>();
    parent.set(key, map);
    return map;
}

/**
 * Core primitive: find a Y.Map element inside `arr` whose `identityField`
 * equals `identityValue`. Returns undefined if none matches.
 */
function findElementByKey(
    arr: Y.Array<unknown>,
    identityField: string,
    identityValue: unknown,
): Y.Map<unknown> | undefined {
    for (let i = 0; i < arr.length; i++) {
        const el = arr.get(i);
        if (el instanceof Y.Map && el.get(identityField) === identityValue) {
            return el;
        }
    }
    return undefined;
}

/**
 * Set every own field of a plain object onto a Y.Map, one scalar at a time.
 *
 * Setting each field individually (rather than nesting the plain object as a
 * single value) keeps the element CRDT-mergeable at the field level. An array
 * field (e.g. a defect's `photos`) is stored as a plain JS array value: that is
 * deliberately LWW per element — element-level sub-array merge is out of scope
 * for this task; only the top-level collections are CRDT containers.
 */
function assignFields(target: Y.Map<unknown>, source: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(source)) {
        if (v === undefined) continue;
        target.set(k, v);
    }
}

/**
 * Upsert a Y.Map element keyed by `identityField` into `arr`: if an element
 * with the same identity exists, merge `entry`'s fields onto it; otherwise push
 * a new Y.Map built from `entry`.
 */
function upsertElement(
    arr: Y.Array<unknown>,
    identityField: string,
    entry: Record<string, unknown>,
): void {
    const identityValue = entry[identityField];
    const existing = findElementByKey(arr, identityField, identityValue);
    if (existing) {
        assignFields(existing, entry);
        return;
    }
    const el = new Y.Map<unknown>();
    assignFields(el, entry);
    arr.push([el]);
}

/** Remove the first Y.Map element keyed by `identityField` === `identityValue`. */
function removeElement(
    arr: Y.Array<unknown>,
    identityField: string,
    identityValue: unknown,
): void {
    for (let i = 0; i < arr.length; i++) {
        const el = arr.get(i);
        if (el instanceof Y.Map && el.get(identityField) === identityValue) {
            arr.delete(i, 1);
            return;
        }
    }
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
 * Apply a single SCALAR-field patch to an item inside a Y.Doc transaction.
 *
 * The item is expected to have been pre-seeded via `seedResultsDoc`. If it is
 * absent (defensive path), it is seeded first.
 *
 * This function only handles scalar fields — last-write-wins per scalar is the
 * correct semantics for them. Nested fields (attributes, tabs, photos,
 * recommendations, customComments) are NO LONGER set through this function:
 * setting a plain JS array/object here would REPLACE the seeded Yjs container
 * with a plain value, defeating CRDT merge and breaking projectResults'
 * instanceof checks. Use the dedicated container mutators below for those.
 */
export function applyItemPatch(
    doc: Y.Doc,
    findingKey: FindingKey,
    field:
        | 'rating'
        | 'notes'
        | 'value'
        | 'recommendation'
        | 'estimateMin'
        | 'estimateMax'
        | 'followupStatus'
        | 'followupNotes',
    value: unknown,
): void {
    const results = doc.getMap<unknown>('results');

    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        item.set(field, value);
    });
}

// ─── Container mutators (CRDT-native, in-place merge) ──────────────────────────

/** Set a key on the item's `attributes` Y.Map (creates the item if absent). */
export function setItemAttribute(
    doc: Y.Doc,
    findingKey: FindingKey,
    key: string,
    value: unknown,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        getOrCreateMap(item, 'attributes').set(key, value);
    });
}

/** Delete a key from the item's `attributes` Y.Map. */
export function deleteItemAttribute(
    doc: Y.Doc,
    findingKey: FindingKey,
    key: string,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        getOrCreateMap(item, 'attributes').delete(key);
    });
}

/**
 * Append (or merge) a photo into the item's `photos` Y.Array.
 * If a photo Y.Map with the same `key` exists, its fields are replaced/merged;
 * otherwise a new photo Y.Map is pushed.
 */
export function appendPhoto(
    doc: Y.Doc,
    findingKey: FindingKey,
    photo: PhotoEntry,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        upsertElement(getOrCreateArray(item, 'photos'), 'key', { ...photo });
    });
}

/**
 * #181 PR-G — push a brand-new PENDING photo entry, deduped by `pendingId`
 * (NOT by `key`).
 *
 * A brand-new offline photo has an EMPTY `key`, so `appendPhoto`'s upsert-by-key
 * would merge two concurrent offline adds into one element. This mutator instead
 * keys on the unique `pendingId`: an entry with the same `pendingId` is merged,
 * otherwise a fresh element is pushed — so two offline adds yield two entries.
 */
export function pushPendingPhoto(
    doc: Y.Doc,
    findingKey: FindingKey,
    photo: PhotoEntry & { pendingId: string },
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        upsertElement(getOrCreateArray(item, 'photos'), 'pendingId', { ...photo });
    });
}

/** Apply a partial patch to the photo Y.Map matching `key`. */
export function updatePhoto(
    doc: Y.Doc,
    findingKey: FindingKey,
    key: string,
    patch: Partial<PhotoEntry>,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        const el = findElementByKey(getOrCreateArray(item, 'photos'), 'key', key);
        if (el) assignFields(el, { ...patch });
    });
}

/** Remove the photo Y.Map matching `key`. */
export function removePhoto(
    doc: Y.Doc,
    findingKey: FindingKey,
    key: string,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        removeElement(getOrCreateArray(item, 'photos'), 'key', key);
    });
}

/**
 * Revert a photo back to its original `key`, stripping every derivative
 * (croppedKey / annotatedKey / annotationsJson / crop).
 *
 * `assignFields` skips `undefined` and never deletes a Y.Map entry, so
 * `updatePhoto(key, { croppedKey: undefined, ... })` CANNOT clear derivatives.
 * Revert therefore REPLACES the photo Y.Map with a fresh `{ key }`-only entry,
 * preserving array position (replace-in-place by index). No-ops if absent.
 */
export function revertPhoto(
    doc: Y.Doc,
    findingKey: FindingKey,
    key: string,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        const arr = getOrCreateArray(item, 'photos');
        for (let i = 0; i < arr.length; i++) {
            const el = arr.get(i);
            if (el instanceof Y.Map && el.get('key') === key) {
                const fresh = new Y.Map<unknown>();
                fresh.set('key', key);
                arr.delete(i, 1);
                arr.insert(i, [fresh]);
                return;
            }
        }
    });
}

/**
 * Replace the photo Y.Map matching `key` IN PLACE with a fresh Y.Map built from
 * `entry`, so the resulting projection has EXACTLY `entry`'s fields — no stale
 * derivatives survive.
 *
 * Crop's sequential-layering rule requires DROPPING `annotatedKey` /
 * `annotationsJson` while setting `croppedKey` / `crop`. `updatePhoto` cannot do
 * this: `assignFields` skips `undefined` and never deletes a Y.Map entry, so a
 * merge would leave the old annotation behind. Replace-in-place (mirror of
 * `revertPhoto`, but with a full entry) is the correct primitive. Array position
 * is preserved (`delete(i,1)` + `insert(i, …)`). No-op if `key` is absent.
 */
export function replacePhoto(
    doc: Y.Doc,
    findingKey: FindingKey,
    key: string,
    entry: PhotoEntry,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        const arr = getOrCreateArray(item, 'photos');
        for (let i = 0; i < arr.length; i++) {
            const el = arr.get(i);
            if (el instanceof Y.Map && el.get('key') === key) {
                const fresh = new Y.Map<unknown>();
                assignFields(fresh, { ...entry });
                arr.delete(i, 1);
                arr.insert(i, [fresh]);
                return;
            }
        }
    });
}

/**
 * #181 PR-G — replace the photo Y.Map whose `pendingId` === `pendingId` IN PLACE
 * with a fresh Y.Map built from `entry`.
 *
 * A brand-new offline photo entry has an EMPTY `key`, so two concurrent offline
 * adds collide under `replacePhoto` (which matches by `key`). The drain swap must
 * therefore address by the unique `pendingId`, not the key. Array position is
 * preserved. No-op if no element carries the id.
 */
export function replacePhotoByPendingId(
    doc: Y.Doc,
    findingKey: FindingKey,
    pendingId: string,
    entry: PhotoEntry,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        const arr = getOrCreateArray(item, 'photos');
        for (let i = 0; i < arr.length; i++) {
            const el = arr.get(i);
            if (el instanceof Y.Map && el.get('pendingId') === pendingId) {
                const fresh = new Y.Map<unknown>();
                assignFields(fresh, { ...entry });
                arr.delete(i, 1);
                arr.insert(i, [fresh]);
                return;
            }
        }
    });
}

/**
 * Reorder the item's `photos` Y.Array so its elements follow `orderedKeys`
 * (matched by each photo Y.Map's `key`).
 *
 * If `orderedKeys` is a 1:1 permutation of the existing photo keys, the array
 * is rebuilt wholesale in the requested order (fresh Y.Maps from each entry's
 * `.toJSON()`). If it is NOT a 1:1 permutation (missing / extra / duplicate
 * keys), the array is left unchanged — mirrors the guard in
 * `usePhotoOps.onReorderPhotos` (`reordered.length === photos.length`).
 *
 * Reorder is inherently wholesale; losing per-photo CRDT identity on reorder is
 * acceptable and matches LWW semantics for ordering.
 */
export function reorderPhotos(
    doc: Y.Doc,
    findingKey: FindingKey,
    orderedKeys: string[],
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        const arr = getOrCreateArray(item, 'photos');

        // Snapshot current photos into a key → PhotoEntry map.
        const byKey = new Map<string, PhotoEntry>();
        for (let i = 0; i < arr.length; i++) {
            const el = arr.get(i);
            if (el instanceof Y.Map) {
                const entry = el.toJSON() as PhotoEntry;
                if (typeof entry.key === 'string') byKey.set(entry.key, entry);
            }
        }

        // Guard: orderedKeys must be a 1:1 permutation of the existing keys.
        if (orderedKeys.length !== byKey.size) return;
        const seen = new Set<string>();
        for (const k of orderedKeys) {
            if (!byKey.has(k) || seen.has(k)) return; // missing / duplicate → no-op
            seen.add(k);
        }

        // Rebuild the array in the requested order.
        arr.delete(0, arr.length);
        const rebuilt = orderedKeys.map((k) => {
            const el = new Y.Map<unknown>();
            assignFields(el, { ...(byKey.get(k) as PhotoEntry) });
            return el;
        });
        arr.push(rebuilt);
    });
}

/**
 * Move one photo between items in a single transaction: read the photo
 * `PhotoEntry` from the source item's `photos` (by `key`); if absent, no-op;
 * else remove it from the source array and upsert it (by `key`) into the target
 * item's `photos` array. Tenant / finding-key scoping is the caller's concern.
 */
export function movePhoto(
    doc: Y.Doc,
    fromFindingKey: FindingKey,
    toFindingKey: FindingKey,
    photoKey: string,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const fromItem = getOrSeedItem(results, fromFindingKey);
        const fromArr = getOrCreateArray(fromItem, 'photos');
        const el = findElementByKey(fromArr, 'key', photoKey);
        if (!el) return; // absent → no-op
        const entry = el.toJSON() as PhotoEntry;

        removeElement(fromArr, 'key', photoKey);

        const toItem = getOrSeedItem(results, toFindingKey);
        upsertElement(getOrCreateArray(toItem, 'photos'), 'key', { ...entry });
    });
}

/**
 * Upsert a canned-comment entry into `tabs[tab]`, keyed by `cannedId`.
 * Provided fields are merged onto the existing entry (or a new one is created).
 */
export function upsertCanned(
    doc: Y.Doc,
    findingKey: FindingKey,
    tab: CannedTab,
    entry: Partial<CannedState & DefectState> & { cannedId: string },
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        const tabs = getOrCreateMap(item, 'tabs');
        upsertElement(getOrCreateArray(tabs, tab), 'cannedId', { ...entry });
    });
}

/** Remove the canned-comment entry in `tabs[tab]` matching `cannedId`. */
export function removeCanned(
    doc: Y.Doc,
    findingKey: FindingKey,
    tab: CannedTab,
    cannedId: string,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        const tabs = getOrCreateMap(item, 'tabs');
        removeElement(getOrCreateArray(tabs, tab), 'cannedId', cannedId);
    });
}

/**
 * Upsert a custom-comment entry into `customComments[tab]`, keyed by `id`.
 * Provided fields are merged onto the existing entry (or a new one is created).
 */
export function upsertCustomComment(
    doc: Y.Doc,
    findingKey: FindingKey,
    tab: CannedTab,
    entry: Partial<CustomCommentEntry> & { id: string },
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        const cc = getOrCreateMap(item, 'customComments');
        upsertElement(getOrCreateArray(cc, tab), 'id', { ...entry });
    });
}

/** Remove the custom-comment entry in `customComments[tab]` matching `id`. */
export function removeCustomComment(
    doc: Y.Doc,
    findingKey: FindingKey,
    tab: CannedTab,
    id: string,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        const cc = getOrCreateMap(item, 'customComments');
        removeElement(getOrCreateArray(cc, tab), 'id', id);
    });
}

/**
 * Upsert a repair-item snapshot into the item's `recommendations` Y.Array,
 * keyed by `recommendationId`.
 */
export function upsertRecommendation(
    doc: Y.Doc,
    findingKey: FindingKey,
    rec: RepairItemSnapshot,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        upsertElement(
            getOrCreateArray(item, 'recommendations'),
            'recommendationId',
            { ...rec },
        );
    });
}

/** Remove the recommendation snapshot matching `recommendationId`. */
export function removeRecommendation(
    doc: Y.Doc,
    findingKey: FindingKey,
    recommendationId: string,
): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        removeElement(
            getOrCreateArray(item, 'recommendations'),
            'recommendationId',
            recommendationId,
        );
    });
}

/**
 * Delete each key in `keys` from `doc.getMap('results')` in a single transaction.
 *
 * Used by the DO restructure path (D8): when a templateSnapshot edit removes a
 * section or item, the corresponding findingKey entry is purged from the live doc
 * so the projection no longer includes stale keys. The change is broadcast to all
 * clients via broadcastRestore() (same convergence guarantee as restore).
 *
 * No-op when `keys` is empty (avoids an unnecessary transaction).
 * Silently ignores keys that are absent — idempotent.
 */
export function removeFindingKeys(doc: Y.Doc, keys: string[]): void {
    if (keys.length === 0) return;
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        for (const k of keys) {
            results.delete(k);
        }
    });
}

/**
 * Hydrate a Y.Doc from an existing `inspection_results.data` projection blob.
 *
 * The faithful INVERSE of `projectResults`: after `loadResultsProjection(doc, p)`,
 * `projectResults(doc)` deep-equals `p`. Used by the Durable Object (#181) to
 * import the legacy/current D1 blob on first connect so collaborative editing
 * starts from current truth instead of an empty doc (which would otherwise wipe
 * the D1 row on the first persist).
 *
 * Pure Yjs, no I/O. Idempotent: every nested collection is rebuilt through the
 * upsert-by-identity-key mutators, so re-loading the same blob never duplicates
 * array elements. The whole load runs in a single `doc.transact`.
 */
export function loadResultsProjection(doc: Y.Doc, projection: ResultsProjection): void {
    const results = doc.getMap<unknown>('results');

    doc.transact(() => {
        for (const [findingKey, entry] of Object.entries(projection)) {
            // Idempotent structure first (Condition A): never clobber existing.
            getOrSeedItem(results, findingKey);

            // ── Scalar fields (LWW) ────────────────────────────────────────────
            // Only set fields that projectResults would surface, matching its
            // type/empty guards so the round-trip is exact.
            if (typeof entry.rating === 'string' && entry.rating.length > 0) {
                applyItemPatch(doc, findingKey, 'rating', entry.rating);
            }
            if (typeof entry.notes === 'string' && entry.notes.length > 0) {
                applyItemPatch(doc, findingKey, 'notes', entry.notes);
            }
            if (entry.value !== undefined && entry.value !== null) {
                applyItemPatch(doc, findingKey, 'value', entry.value);
            }
            if (typeof entry.recommendation === 'string' && entry.recommendation.length > 0) {
                applyItemPatch(doc, findingKey, 'recommendation', entry.recommendation);
            }
            if (typeof entry.estimateMin === 'number') {
                applyItemPatch(doc, findingKey, 'estimateMin', entry.estimateMin);
            }
            if (typeof entry.estimateMax === 'number') {
                applyItemPatch(doc, findingKey, 'estimateMax', entry.estimateMax);
            }
            if (entry.followupStatus !== undefined) {
                applyItemPatch(doc, findingKey, 'followupStatus', entry.followupStatus);
            }
            if (entry.followupNotes !== undefined) {
                applyItemPatch(doc, findingKey, 'followupNotes', entry.followupNotes);
            }

            // ── attributes ─────────────────────────────────────────────────────
            if (entry.attributes) {
                for (const [k, v] of Object.entries(entry.attributes)) {
                    setItemAttribute(doc, findingKey, k, v);
                }
            }

            // ── photos ─────────────────────────────────────────────────────────
            if (entry.photos) {
                for (const photo of entry.photos) {
                    appendPhoto(doc, findingKey, photo);
                }
            }

            // ── tabs (information / limitations / defects) ──────────────────────
            if (entry.tabs) {
                for (const e of entry.tabs.information ?? []) {
                    upsertCanned(doc, findingKey, 'information', e);
                }
                for (const e of entry.tabs.limitations ?? []) {
                    upsertCanned(doc, findingKey, 'limitations', e);
                }
                for (const e of entry.tabs.defects ?? []) {
                    upsertCanned(doc, findingKey, 'defects', e);
                }
            }

            // ── customComments ─────────────────────────────────────────────────
            if (entry.customComments) {
                for (const e of entry.customComments.information ?? []) {
                    upsertCustomComment(doc, findingKey, 'information', e);
                }
                for (const e of entry.customComments.limitations ?? []) {
                    upsertCustomComment(doc, findingKey, 'limitations', e);
                }
                for (const e of entry.customComments.defects ?? []) {
                    upsertCustomComment(doc, findingKey, 'defects', e);
                }
            }

            // ── recommendations ────────────────────────────────────────────────
            if (entry.recommendations) {
                for (const rec of entry.recommendations) {
                    upsertRecommendation(doc, findingKey, rec);
                }
            }

            // ── re-inspection `original` snapshot ──────────────────────────────
            // projectResults reads `original` as a Y.Map (rating/notes scalars +
            // a photos Y.Array). It is a read-only snapshot, so LWW assignment is
            // correct. Rebuild the Y.Map in place (idempotent — overwrite).
            if (entry.original) {
                const item = getOrSeedItem(results, findingKey);
                const orig = getOrCreateMap(item, 'original');
                if (entry.original.rating !== undefined) {
                    orig.set('rating', entry.original.rating);
                }
                if (entry.original.notes !== undefined) {
                    orig.set('notes', entry.original.notes);
                }
                if (entry.original.photos && entry.original.photos.length > 0) {
                    // Replace the photos array wholesale (idempotent snapshot).
                    const photosArr = new Y.Array<unknown>();
                    for (const photo of entry.original.photos) {
                        const el = new Y.Map<unknown>();
                        assignFields(el, { ...photo });
                        photosArr.push([el]);
                    }
                    orig.set('photos', photosArr);
                }
            }
        }
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

        // ── recommendations ────────────────────────────────────────────────────

        const recsRaw = rawItem.get('recommendations');
        if (recsRaw instanceof Y.Array && recsRaw.length > 0) {
            entry.recommendations = recsRaw.toJSON() as RepairItemSnapshot[];
        }

        // ── customComments ─────────────────────────────────────────────────────

        const customRaw = rawItem.get('customComments');
        if (customRaw instanceof Y.Map) {
            const ccInfo = customRaw.get('information');
            const ccLim  = customRaw.get('limitations');
            const ccDef  = customRaw.get('defects');

            const ccInfoArr = ccInfo instanceof Y.Array
                ? (ccInfo.toJSON() as CustomCommentEntry[])
                : [];
            const ccLimArr  = ccLim instanceof Y.Array
                ? (ccLim.toJSON() as CustomCommentEntry[])
                : [];
            const ccDefArr  = ccDef instanceof Y.Array
                ? (ccDef.toJSON() as CustomCommentEntry[])
                : [];

            if (ccInfoArr.length > 0 || ccLimArr.length > 0 || ccDefArr.length > 0) {
                const ccEntry: NonNullable<ItemEntry['customComments']> = {};
                if (ccInfoArr.length > 0) ccEntry.information = ccInfoArr;
                if (ccLimArr.length  > 0) ccEntry.limitations = ccLimArr;
                if (ccDefArr.length  > 0) ccEntry.defects     = ccDefArr;
                entry.customComments = ccEntry;
            }
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
