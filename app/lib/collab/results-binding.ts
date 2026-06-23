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
    upsertCanned,
    upsertCustomComment,
    upsertRecommendation,
    removeRecommendation,
} from '../../../server/lib/collab/results-doc';
import type { RepairItemSnapshot } from '../../../server/lib/collab/results-doc.types';

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

/** Set the rating scalar on a finding (last-write-wins via CRDT scalar). */
export function setRating(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    rating: string | null,
): void {
    applyItemPatch(doc, findingKey(null, sectionId, itemId), 'rating', rating);
}

/** Set the inspector notes scalar on a finding. */
export function setNotes(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    notes: string,
): void {
    applyItemPatch(doc, findingKey(null, sectionId, itemId), 'notes', notes);
}

/** Set the non-rated value scalar on a finding (boolean/text/number/select/etc.). */
export function setValue(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    value: unknown,
): void {
    applyItemPatch(doc, findingKey(null, sectionId, itemId), 'value', value);
}

/** Set a key on the finding's structured `attributes` property bag. */
export function setItemAttribute(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    key: string,
    value: unknown,
): void {
    docSetItemAttribute(doc, findingKey(null, sectionId, itemId), key, value);
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
): void {
    upsertCanned(doc, findingKey(null, sectionId, itemId), tab, { cannedId, included });
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
): void {
    upsertCanned(doc, findingKey(null, sectionId, itemId), 'defects', { cannedId, ...patch });
}

/** Append (or merge) a photo attachment to the finding's photo array. */
export function appendPhoto(
    doc: Y.Doc,
    sectionId: string,
    itemId: string,
    photo: { key: string } & Record<string, unknown>,
): void {
    docAppendPhoto(doc, findingKey(null, sectionId, itemId), photo);
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
): void {
    upsertCustomComment(doc, findingKey(null, sectionId, itemId), 'defects', entry);
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
): void {
    // The editor's AttachedRepairItem is structurally a RepairItemSnapshot
    // (recommendationId + the five estimate/summary/contractor/attachedAt
    // fields), so the call boundary is fully typed — no cast.
    upsertRecommendation(doc, findingKey(null, sectionId, itemId), rec);
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
): void {
    removeRecommendation(doc, findingKey(null, sectionId, itemId), recommendationId);
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
): void {
    upsertCustomComment(doc, findingKey(null, sectionId, itemId), 'defects', { id: customId, included });
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
): void {
    const fk = findingKey(null, sectionId, itemId);
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
): void {
    const fk = findingKey(null, sectionId, itemId);
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
 * Mirrors `useFindingsCanned.insertComment` join semantics:
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
): void {
    const fk = findingKey(null, sectionId, itemId);
    const entry = readResultMap(doc)[fk];
    const oldNotes = (entry?.notes as string | undefined) ?? '';
    const sep = withExtraNewline ? '\n\n' : '\n';
    const merged = oldNotes ? oldNotes.trimEnd() + sep + text : text;
    applyItemPatch(doc, fk, 'notes', merged);
}
