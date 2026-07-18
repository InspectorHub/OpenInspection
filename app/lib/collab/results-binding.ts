/**
 * Bridges a live Y.Doc (from `use-results-doc.ts`) to the editor's in-memory
 * ResultMap, and provides write helpers that mirror the editor's existing hook
 * signatures so Task 9 can swap them in 1:1.
 *
 * NO React import. NO import of app/hooks/useInspection.ts (React-heavy).
 */

import * as Y from 'yjs';
import { findingKey, parseFindingKey } from '../../../server/lib/finding-key';
import {
    projectResults,
    applyItemPatch,
    setItemAttribute as docSetItemAttribute,
    appendPhoto as docAppendPhoto,
    pushPendingPhoto as docPushPendingPhoto,
    updatePhoto as docUpdatePhoto,
    removePhoto as docRemovePhoto,
    revertPhoto as docRevertPhoto,
    replacePhoto as docReplacePhoto,
    replacePhotoByPendingId as docReplacePhotoByPendingId,
    reorderPhotos as docReorderPhotos,
    movePhoto as docMovePhoto,
    upsertCanned,
    upsertCustomComment,
    upsertRecommendation,
    removeRecommendation,
} from '../../../server/lib/collab/results-doc';
import type { PhotoEntry, RepairItemSnapshot } from '../../../server/lib/collab/results-doc.types';

// ─── ResultMap type ──────────────────────────────────────────────────────────
//
// Must stay structurally identical to `ResultMap` in `app/hooks/useInspection.ts`.
// It is a plain alias — no drift risk because the type is Record<string, Record<string, unknown>>.
// We define it locally to keep this file React-free.

/** Structural alias of `ResultMap` from `app/hooks/useInspection.ts`. Do not let this drift. */
export type ResultMap = Record<string, Record<string, unknown>>;

// ─── Read model ───────────────────────────────────────────────────────────────

/**
 * Build the dual-keyed ResultMap the editor consumes from the live doc.
 *
 * For each composite finding key (e.g. `_default:s1:i1`) the entry is stored
 * under BOTH the composite key AND the bare itemId. This mirrors the dual-key
 * writes in `useInspection.ts` that `getResult(itemId, sectionId?)` relies on.
 *
 * Phase U (per-unit keying) note: this projection stays FULL-SCOPE — it emits
 * every unit's composite key (`_default:…`, `u1:…`, `u2:…`) plus the bare
 * itemId. In per-unit mode two units share the same itemId, so the bare key is
 * ambiguous (last write wins). Scoping is therefore done at the READ-RESOLVER
 * layer (`getResult` / the item-list read), which resolves the composite
 * `findingKey(activeUnitId, sectionId, itemId)` and only falls back to the bare
 * itemId when `activeUnitId === null` (the `_default` view). Keeping the
 * projection full-scope means a `_default`-only doc produces byte-identical
 * output to before this change, and no re-projection is needed when the active
 * unit changes. See finding-key.ts / Phase U Batch C1.
 */
export function readResultMap(doc: Y.Doc): ResultMap {
    const projection = projectResults(doc);
    const result: ResultMap = {};

    for (const [key, entry] of Object.entries(projection)) {
        const { itemId } = parseFindingKey(key);
        // Cast is safe: ItemEntry fields are all Record<string, unknown>-compatible.
        const asRecord = entry as Record<string, unknown>;
        result[key]    = asRecord;
        result[itemId] = asRecord; // same object reference — mirrors editor's dual-key pattern
    }

    return result;
}

/**
 * Observe the doc's results map deeply; call `onChange(readResultMap(doc))` on
 * any change. Returns an unsubscribe function.
 */
export function bindResultMap(
    doc: Y.Doc,
    onChange: (next: ResultMap) => void,
): () => void {
    const handler = (): void => {
        onChange(readResultMap(doc));
    };
    doc.getMap('results').observeDeep(handler);
    return () => doc.getMap('results').unobserveDeep(handler);
}

// ─── Write helpers ────────────────────────────────────────────────────────────
//
// Signatures mirror the editor's existing write hooks (useInspection.ts) so
// Task 9 can swap them in 1:1. Each helper resolves the composite finding key
// and routes to the Task 7p mutator in results-doc.ts.
//
// Phase U (Batch C1): each helper accepts an OPTIONAL trailing
// `unitId: string | null` (default `null`) that is threaded into
// `findingKey(unitId, …)`. `null` yields the `_default` scope, so every existing
// call site (and every existing test) is byte-identical to before. A non-null
// unit id writes ONLY that unit's finding (`u1:sectionId:itemId`), so two units
// carrying the SAME itemId never collide. The param is trailing-optional (rather
// than a required scope arg) precisely to keep this a zero-behavior-change,
// zero-call-site-churn refactor until the scope switcher (Batch C2) lands.

/** Set the rating scalar on a finding (last-write-wins via CRDT scalar). */
export function setRating(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    rating: string | null,
    unitId: string | null = null,
): void {
    applyItemPatch(doc, findingKey(unitId, sectionId, itemId), 'rating', rating);
}

/** Set the inspector notes scalar on a finding. */
export function setNotes(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    notes: string,
    unitId: string | null = null,
): void {
    applyItemPatch(doc, findingKey(unitId, sectionId, itemId), 'notes', notes);
}

/** Set the non-rated value scalar on a finding (boolean/text/number/select/etc.). */
export function setValue(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    value: unknown,
    unitId: string | null = null,
): void {
    applyItemPatch(doc, findingKey(unitId, sectionId, itemId), 'value', value);
}

/** Set a key on the finding's structured `attributes` property bag. */
export function setItemAttribute(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    key: string,
    value: unknown,
    unitId: string | null = null,
): void {
    docSetItemAttribute(doc, findingKey(unitId, sectionId, itemId), key, value);
}

/**
 * Toggle a canned comment entry in the given tab (`information`, `limitations`,
 * or `defects`). Uses `upsertCanned` — CRDT-safe, keyed by `cannedId`.
 */
export function toggleCanned(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    tab: 'information' | 'limitations' | 'defects',
    cannedId: string,
    included: boolean,
    unitId: string | null = null,
): void {
    upsertCanned(doc, findingKey(unitId, sectionId, itemId), tab, { cannedId, included });
}

/**
 * Merge per-defect override fields (location, category, photos, …) onto a
 * canned defect entry. Routed through `upsertCanned('defects', …)`.
 */
export function setDefectFields(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    cannedId: string,
    patch: Record<string, unknown>,
    unitId: string | null = null,
): void {
    upsertCanned(doc, findingKey(unitId, sectionId, itemId), 'defects', { cannedId, ...patch });
}

/** Append (or merge) a photo attachment to the finding's photo array. */
export function appendPhoto(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    photo: { key: string } & Record<string, unknown>,
    unitId: string | null = null,
): void {
    docAppendPhoto(doc, findingKey(unitId, sectionId, itemId), photo);
}

/**
 * Reorder a finding's photo array to follow `orderedKeys` (original photo keys).
 * No-op if `orderedKeys` is not a 1:1 permutation of the current keys (mirrors
 * the legacy REST path guard). `findingKey` is the composite key.
 */
export function reorderPhotos(
    doc: Y.Doc,
    findingKey: string,
    orderedKeys: string[],
): void {
    docReorderPhotos(doc, findingKey, orderedKeys);
}

/**
 * Move one photo (by original `key`) from one finding to another, in a single
 * transaction. No-op if the photo is absent on the source. Both keys are
 * composite finding keys.
 */
export function movePhoto(
    doc: Y.Doc,
    fromFindingKey: string,
    toFindingKey: string,
    photoKey: string,
): void {
    docMovePhoto(doc, fromFindingKey, toFindingKey, photoKey);
}

/** Detach (delete) a photo from a finding's photo array, by original `key`. */
export function removePhoto(
    doc: Y.Doc,
    findingKey: string,
    key: string,
): void {
    docRemovePhoto(doc, findingKey, key);
}

/**
 * Revert a photo back to its original `key`, stripping all derivatives
 * (croppedKey / annotatedKey / annotationsJson / crop). `findingKey` is the
 * composite key.
 */
export function revertPhoto(
    doc: Y.Doc,
    findingKey: string,
    key: string,
): void {
    docRevertPhoto(doc, findingKey, key);
}

/**
 * #181 — mirror a server crop bake into the doc. Builds the post-crop entry
 * from the photo's CURRENT fields MINUS any annotation (sequential-layering
 * rule: a re-crop discards the prior annotation, whose coords were in the OLD
 * cropped-pixel space), then sets the new `croppedKey` + `crop` and replaces the
 * entry in place. `baseEntry` is the photo's current entry so non-annotation
 * fields (mediaType / provider / streamUid / …) survive the crop.
 */
export function setPhotoCrop(
    doc: Y.Doc,
    findingKey: string,
    key: string,
    croppedKey: string,
    crop: PhotoEntry['crop'],
    baseEntry: PhotoEntry,
): void {
    // Strip the annotation fields from the base, then re-pin key + crop result.
    const { annotatedKey: _a, annotationsJson: _j, ...keep } = baseEntry;
    void _a; void _j;
    const next: PhotoEntry = { ...keep, key, croppedKey, crop };
    docReplacePhoto(doc, findingKey, key, next);
}

/**
 * #181 — mirror a server annotation bake into the doc. Annotation is additive
 * (it never clears the crop), so a merge patch via `updatePhoto` is correct.
 */
export function setPhotoAnnotation(
    doc: Y.Doc,
    findingKey: string,
    key: string,
    annotatedKey: string,
    annotationsJson: string,
): void {
    docUpdatePhoto(doc, findingKey, key, { annotatedKey, annotationsJson });
}

/**
 * #181 PR-G — append a brand-new offline photo as a PENDING doc entry.
 *
 * The binary is only in the local media-pending store (not yet on R2), so the
 * entry has an EMPTY `key` + `pendingUpload: true` + the `pendingId` that
 * resolves to the local blob. The report SKIPS such entries (it filters
 * `pendingUpload`); the editor renders them from the local objectURL. On drain
 * the entry is swapped to its real R2 key via `resolvePendingPhoto` below.
 */
export function appendPendingPhoto(
    doc: Y.Doc,
    findingKey: string,
    pendingId: string,
): void {
    docPushPendingPhoto(doc, findingKey, {
        key: '',
        pendingUpload: true,
        pendingId,
        pendingKind: 'photo',
        mediaType: 'photo',
    });
}

/**
 * #181 PR-G — mark an EXISTING photo (matched by base `key`) as having a pending
 * offline crop/annotate derivative.
 *
 * The base `key` is KEPT (it still serves the report as an honest fallback) and
 * `pendingUpload` is deliberately NOT set — only the derivative is pending. The
 * `pendingId` + `pendingKind` + the local derivative fields (`crop` for a crop,
 * `annotationsJson` for an annotate) are merged onto the photo so the editor can
 * preview the local derivative. On drain the real `croppedKey` / `annotatedKey`
 * is set and the pending fields are cleared via `resolvePendingPhoto`.
 *
 * Implemented as a replace-in-place (mirror of `setPhotoCrop`/`replacePhoto`)
 * because Y.Map field-delete is not supported by `assignFields`; we build the
 * fresh entry from the photo's CURRENT fields plus the pending markers.
 */
export function markPhotoPending(
    doc: Y.Doc,
    findingKey: string,
    key: string,
    pendingId: string,
    kind: 'crop' | 'annotate',
    extra: { crop?: PhotoEntry['crop']; annotationsJson?: string },
): void {
    const entry = findPhotoEntry(doc, findingKey, key);
    if (!entry) return;
    // A re-crop discards any prior annotation (its coords were in the OLD cropped
    // space). Strip annotation derivatives when the pending op is a crop; keep
    // them for an annotate (annotation layers on top of the crop).
    const base: PhotoEntry =
        kind === 'crop'
            ? (() => {
                  const { annotatedKey: _a, annotationsJson: _j, ...keep } = entry;
                  void _a; void _j;
                  return keep;
              })()
            : entry;
    const next: PhotoEntry = {
        ...base,
        key,
        pendingId,
        pendingKind: kind,
    };
    if (kind === 'crop' && extra.crop !== undefined) next.crop = extra.crop;
    if (kind === 'annotate' && extra.annotationsJson !== undefined) {
        next.annotationsJson = extra.annotationsJson;
    }
    docReplacePhoto(doc, findingKey, key, next);
}

/**
 * #181 PR-G — read one photo entry by `key` from the live doc (or undefined).
 * Used by the drain swap + the pending-mark helpers to rebuild a fresh entry.
 */
function findPhotoEntry(
    doc: Y.Doc,
    findingKey: string,
    key: string,
): PhotoEntry | undefined {
    const entry = readResultMap(doc)[findingKey];
    const photos = (entry?.photos as PhotoEntry[] | undefined) ?? [];
    return photos.find((p) => p.key === key);
}

/**
 * #181 PR-G — resolve a pending photo after its offline blob has uploaded.
 *
 * Swaps the doc entry pending→real key and CLEARS the pending markers
 * (`pendingUpload` / `pendingId` / `pendingKind`) by replace-in-place (field
 * delete is unsupported). The match key differs by kind:
 *  - `photo`:    the entry's `key` is empty; match by the entry whose
 *                `pendingId === pendingId`, then set the real `key` = result.key.
 *  - `crop`:     match by base `key`, set `croppedKey` = result.croppedKey.
 *  - `annotate`: match by base `key`, set `annotatedKey` = result.annotatedKey.
 *
 * No-op if no matching pending entry is found (idempotent — a duplicate drain
 * after the swap simply finds nothing).
 */
export function resolvePendingPhoto(
    doc: Y.Doc,
    findingKey: string,
    pendingId: string,
    kind: 'photo' | 'crop' | 'annotate',
    photoKey: string | undefined,
    result: { key?: string; croppedKey?: string; annotatedKey?: string },
): void {
    const map = readResultMap(doc)[findingKey];
    const photos = (map?.photos as PhotoEntry[] | undefined) ?? [];

    if (kind === 'photo') {
        const target = photos.find((p) => p.pendingId === pendingId && p.pendingUpload);
        if (!target || !result.key) return;
        const { pendingUpload: _u, pendingId: _p, pendingKind: _k, ...keep } = target;
        void _u; void _p; void _k;
        // The pending entry's key is empty (two concurrent offline adds collide
        // under a key match), so address by the unique pendingId.
        docReplacePhotoByPendingId(doc, findingKey, pendingId, { ...keep, key: result.key });
        return;
    }

    // crop / annotate: match by the base key the derivative was applied to.
    if (!photoKey) return;
    const target = photos.find((p) => p.key === photoKey && p.pendingId === pendingId);
    if (!target) return;
    const { pendingUpload: _u, pendingId: _p, pendingKind: _k, ...keep } = target;
    void _u; void _p; void _k;
    const next: PhotoEntry = { ...keep, key: photoKey };
    if (kind === 'crop' && result.croppedKey) next.croppedKey = result.croppedKey;
    if (kind === 'annotate' && result.annotatedKey) next.annotatedKey = result.annotatedKey;
    docReplacePhoto(doc, findingKey, photoKey, next);
}

/**
 * Add (or merge) a custom defect entry into `customComments.defects`.
 * Keyed by `entry.id`.
 */
export function addCustomDefect(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    entry: { id: string } & Record<string, unknown>,
    unitId: string | null = null,
): void {
    upsertCustomComment(doc, findingKey(unitId, sectionId, itemId), 'defects', entry);
}

/**
 * Attach a repair-item snapshot to the finding's recommendations list.
 * Keyed by `rec.recommendationId`.
 */
export function attachRepairItem(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    rec: RepairItemSnapshot,
    unitId: string | null = null,
): void {
    // The editor's AttachedRepairItem is structurally a RepairItemSnapshot
    // (recommendationId + the five estimate/summary/contractor/attachedAt
    // fields), so the call boundary is fully typed — no cast.
    upsertRecommendation(doc, findingKey(unitId, sectionId, itemId), rec);
}

/**
 * Remove a repair-item (recommendation) snapshot from the finding.
 * Mirrors the editor's detachRepairItem(itemId, recommendationId) call.
 */
export function detachRepairItem(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    recommendationId: string,
    unitId: string | null = null,
): void {
    removeRecommendation(doc, findingKey(unitId, sectionId, itemId), recommendationId);
}

/**
 * Flip the `included` flag on a custom defect entry in `customComments.defects`.
 * The upsert merges `included` onto the existing custom-defect Y.Map keyed by id.
 */
export function toggleCustomDefect(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    customId: string,
    included: boolean,
    unitId: string | null = null,
): void {
    upsertCustomComment(doc, findingKey(unitId, sectionId, itemId), 'defects', { id: customId, included });
}

/**
 * Append a photo to a canned defect's photos array (dedup by key).
 * Reads the current defect state from the live doc, then replaces the photos
 * array wholesale via upsertCanned — element-level LWW is the documented
 * behavior for a defect's photos sub-array (Task 7p).
 * No-ops if the canned defect with `cannedId` is not found.
 */
export function addPhotoToCannedDefect(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    cannedId: string,
    photo: { key: string } & Record<string, unknown>,
    unitId: string | null = null,
): void {
    const fk = findingKey(unitId, sectionId, itemId);
    const entry = readResultMap(doc)[fk];
    if (!entry) return;

    const tabs = entry.tabs as {
        defects?: Array<{ cannedId: string; photos?: Array<{ key: string } & Record<string, unknown>> }>;
    } | undefined;

    const defect = tabs?.defects?.find((d) => d.cannedId === cannedId);
    if (!defect) return;

    const existing: Array<{ key: string } & Record<string, unknown>> = defect.photos ?? [];
    if (existing.some((p) => p.key === photo.key)) return;

    const nextPhotos = [...existing, photo];
    upsertCanned(doc, fk, 'defects', { cannedId, photos: nextPhotos });
}

/**
 * Append a photo to a custom defect's photos array (dedup by key).
 * Reads the current custom defect state from the live doc, then replaces the
 * photos array wholesale via upsertCustomComment.
 * No-ops if the custom defect with `customId` is not found.
 */
export function addPhotoToCustomDefect(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    customId: string,
    photo: { key: string } & Record<string, unknown>,
    unitId: string | null = null,
): void {
    const fk = findingKey(unitId, sectionId, itemId);
    const entry = readResultMap(doc)[fk];
    if (!entry) return;

    const customComments = entry.customComments as {
        defects?: Array<{ id: string; photos?: Array<{ key: string } & Record<string, unknown>> }>;
    } | undefined;

    const defect = customComments?.defects?.find((d) => d.id === customId);
    if (!defect) return;

    const existing: Array<{ key: string } & Record<string, unknown>> = defect.photos ?? [];
    if (existing.some((p) => p.key === photo.key)) return;

    const nextPhotos = [...existing, photo];
    upsertCustomComment(doc, fk, 'defects', { id: customId, photos: nextPhotos });
}

/**
 * Append `text` to the item's `notes` scalar field.
 *
 * Library-comment insertion join semantics:
 *   - empty existing notes → just `text`
 *   - otherwise → `oldNotes.trimEnd() + sep + text`
 *     where sep is `'\n\n'` when `withExtraNewline` is true, else `'\n'`.
 */
export function appendNote(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    text: string,
    withExtraNewline?: boolean,
    unitId: string | null = null,
): void {
    const fk = findingKey(unitId, sectionId, itemId);
    const entry = readResultMap(doc)[fk];
    const oldNotes = (entry?.notes as string | undefined) ?? '';
    const sep = withExtraNewline ? '\n\n' : '\n';
    const merged = oldNotes ? oldNotes.trimEnd() + sep + text : text;
    applyItemPatch(doc, fk, 'notes', merged);
}
