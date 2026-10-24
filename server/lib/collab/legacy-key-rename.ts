/**
 * Renaming legacy finding keys inside the live results document.
 *
 * Old results were keyed by the bare item id. Today's key is
 * `_default:<sectionId>:<itemId>`. A results document that was opened in the
 * editor before its blob was converted still holds the bare-keyed item maps,
 * next to empty composite items seeded from the template, so the converted
 * content is invisible and the next persist would write the bare keys back.
 *
 * The rename happens in the document, in ONE transaction, and copies each field
 * of the legacy item generically rather than through the projection (which does
 * not cover every field). Pure Yjs, no I/O.
 */

import * as Y from 'yjs';
import { findingKey, findingKeysFromTemplateSnapshot } from '@core/field-ui/shared/finding-key';

export interface LegacyRenameCounts {
    /** Legacy items moved onto their composite key. */
    renamed:          number;
    /** Underscore-prefixed meta keys with fewer than two colons, left alone. */
    skippedMeta:      number;
    /** Legacy-shaped keys that name no item of the template snapshot, left alone. */
    skippedUnknown:   number;
    /** Legacy keys whose item id sits in more than one section, left alone. */
    skippedAmbiguous: number;
    /** Scalar fields where both sides held different content; the composite side was kept and the legacy value is only in the pre-rename snapshot. */
    conflicts:        number;
}

/** Template item id -> the distinct section ids that contain it. */
export function itemSectionsFromSnapshot(snapshot: unknown): Map<string, string[]> {
    const sections = new Map<string, string[]>();
    for (const key of findingKeysFromTemplateSnapshot(snapshot)) {
        const parts = key.split(':');
        // An id that itself contains a colon cannot be split back apart
        // unambiguously, and a legacy bare key never carried one.
        if (parts.length !== 3) continue;
        const [, sectionId, itemId] = parts as [string, string, string];
        const held = sections.get(itemId) ?? [];
        if (!held.includes(sectionId)) held.push(sectionId);
        sections.set(itemId, held);
    }
    return sections;
}

/** True when the value carries nothing a reader could show. */
function isDeepEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.length === 0;
    if (value instanceof Y.Map) return [...value.values()].every(isDeepEmpty);
    if (value instanceof Y.Array) return value.toArray().every(isDeepEmpty);
    if (Array.isArray(value)) return value.every(isDeepEmpty);
    if (typeof value === 'object') return Object.values(value).every(isDeepEmpty);
    return false;
}

function toJson(value: unknown): string {
    return JSON.stringify(value instanceof Y.AbstractType ? value.toJSON() : value);
}

/** A copy that can be integrated somewhere else, keeping Yjs containers as containers. */
function cloneValue(value: unknown): unknown {
    if (value instanceof Y.Map || value instanceof Y.Array) return value.clone();
    if (typeof value === 'object' && value !== null) return structuredClone(value);
    return value;
}

/**
 * Fold `from` into `into` field by field, losing nothing a reader could show
 * except a scalar the composite side already answers:
 *
 *   - an empty composite field takes the legacy value;
 *   - two nested maps merge recursively, so content in a different sub-field
 *     survives;
 *   - two arrays (photos, canned comments, custom comments ...) are UNIONED,
 *     deduplicated by element JSON, composite elements first;
 *   - any other pair that differs keeps the composite value (it is what someone
 *     edited in the new structure) and counts one conflict.
 *
 * Returns the number of conflicts.
 */
function mergeInto(into: Y.Map<unknown>, from: Y.Map<unknown>): number {
    let conflicts = 0;
    for (const [field, incoming] of from.entries()) {
        if (isDeepEmpty(incoming)) continue;
        const current = into.get(field);
        if (isDeepEmpty(current)) {
            into.set(field, cloneValue(incoming));
        } else if (current instanceof Y.Map && incoming instanceof Y.Map) {
            conflicts += mergeInto(current, incoming);
        } else if (current instanceof Y.Array && incoming instanceof Y.Array) {
            const seen = new Set(current.toArray().map(toJson));
            for (const element of incoming.toArray()) {
                const json = toJson(element);
                if (seen.has(json)) continue;
                seen.add(json);
                current.push([cloneValue(element)]);
            }
        } else if (toJson(current) !== toJson(incoming)) {
            conflicts += 1;
        }
    }
    return conflicts;
}

type KeyClass =
    | { kind: 'composite' }
    | { kind: 'meta' | 'unknown' | 'ambiguous' }
    | { kind: 'rename'; sectionId: string };

/**
 * What the rename does with one key of the results map. A legacy key has fewer
 * than three colon-separated parts; of those, an underscore prefix marks meta
 * data (the inspector signature). Composite keys also start with `_default:`,
 * which is why the colon count comes first. This is the same rule as `isMetaKey`
 * in `packages/field-ui/src/shared/finding-key.ts`, spelled out here because the composite check
 * has to come before the meta check.
 */
function classify(key: string, value: unknown, itemSections: Map<string, string[]>): KeyClass {
    if (key.split(':').length >= 3) return { kind: 'composite' };
    if (key.startsWith('_')) return { kind: 'meta' };
    const sections = itemSections.get(key);
    if (!sections || !(value instanceof Y.Map)) return { kind: 'unknown' };
    if (sections.length !== 1) return { kind: 'ambiguous' };
    return { kind: 'rename', sectionId: sections[0] as string };
}

/** True when a rename would move at least one key. Used to decide whether a safety snapshot is worth taking. */
export function hasRenamableLegacyKeys(doc: Y.Doc, itemSections: Map<string, string[]>): boolean {
    for (const [key, value] of doc.getMap<unknown>('results').entries()) {
        if (classify(key, value, itemSections).kind === 'rename') return true;
    }
    return false;
}

/**
 * Move every bare-keyed item whose id belongs to exactly one section of the
 * template onto `_default:<sectionId>:<itemId>`, then drop the bare key.
 * Idempotent: a second run finds no bare key it may move.
 */
export function renameLegacyFindingKeys(doc: Y.Doc, itemSections: Map<string, string[]>): LegacyRenameCounts {
    const counts: LegacyRenameCounts = { renamed: 0, skippedMeta: 0, skippedUnknown: 0, skippedAmbiguous: 0, conflicts: 0 };
    const results = doc.getMap<unknown>('results');

    doc.transact(() => {
        for (const key of [...results.keys()]) {
            const legacy = results.get(key);
            const klass = classify(key, legacy, itemSections);
            if (klass.kind === 'composite') continue;
            if (klass.kind === 'meta') counts.skippedMeta += 1;
            else if (klass.kind === 'unknown') counts.skippedUnknown += 1;
            else if (klass.kind === 'ambiguous') counts.skippedAmbiguous += 1;
            if (klass.kind !== 'rename' || !(legacy instanceof Y.Map)) continue;

            const compositeKey = findingKey(null, klass.sectionId, key);
            const held = results.get(compositeKey);
            // A composite entry that is not an item map is not ours to replace.
            if (held !== undefined && !(held instanceof Y.Map)) {
                counts.skippedUnknown += 1;
                continue;
            }
            if (held === undefined) results.set(compositeKey, new Y.Map<unknown>());
            const target = results.get(compositeKey);
            if (!(target instanceof Y.Map)) continue;

            counts.conflicts += mergeInto(target, legacy);
            results.delete(key);
            counts.renamed += 1;
        }
    });

    return counts;
}
