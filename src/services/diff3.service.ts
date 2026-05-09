import { diff3Merge } from 'node-diff3';

export interface AttachedRecommendation {
    recommendationId:    string;
    estimateSnapshotMin: number | null;
    estimateSnapshotMax: number | null;
    summarySnapshot:     string;
    attachedAt:          number;
}

export interface ItemResult {
    status: string | null;
    notes:  string;
    photos: Array<{ key: string; annotatedKey?: string; annotationsJson?: string }>;
    updatedAt: number;
    recommendations?: AttachedRecommendation[];   // optional — older inspection results may lack it
}
export type ResultsBlob = Record<string, ItemResult>;

export interface MergeConflict {
    itemId: string;
    field:  'notes';
    base:   string;
    ours:   string;
    theirs: string;
}

export interface MergeOutcome {
    merged:    ResultsBlob;
    conflicts: MergeConflict[];
}

/**
 * Per-item dirty-field map. Keys are item IDs; values are the subset of
 * fields the local user has edited since the last successful sync.
 *
 * Iter-2 bug #11 — narrows the conflict surface so server-only updates
 * (admin toggles, signature events, automation writes) cannot pop a
 * conflict at the inspector for fields they never touched.
 *
 * When the map is `undefined` the merge falls back to the pre-bug-#11
 * "treat every field as dirty" behaviour so older clients keep working.
 */
export type DirtyField = 'status' | 'notes' | 'photos' | 'recommendations';
export type DirtyFieldsMap = Record<string, DirtyField[]>;

const ALL_FIELDS: readonly DirtyField[] = ['status', 'notes', 'photos', 'recommendations'] as const;

function isDirty(dirty: DirtyField[] | undefined, field: DirtyField): boolean {
    // Backwards-compat: a missing dirty list means "everything is dirty" so
    // older clients that don't ship the dirty-field tracker keep merging the
    // way they always have.
    if (!dirty) return true;
    return dirty.includes(field);
}

/**
 * Three-way merge of inspection-results blobs.
 * - status: LWW by per-item updatedAt
 * - notes:  diff3 line-level merge; collisions surface as MergeConflict
 * - photos: array union by `key`
 * Items present on only one side are added (no merge needed).
 *
 * If `dirtyFields` is supplied, only the fields listed for an item are
 * eligible to flip "ours" — every other field on that item silently
 * takes theirs (or base when theirs is missing). See DirtyFieldsMap.
 */
export function mergeResults(
    base: ResultsBlob,
    ours: ResultsBlob,
    theirs: ResultsBlob,
    dirtyFields?: DirtyFieldsMap,
): MergeOutcome {
    const allItems = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
    const merged:    ResultsBlob = {};
    const conflicts: MergeConflict[] = [];

    for (const itemId of allItems) {
        const b = base[itemId];
        const o = ours[itemId];
        const t = theirs[itemId];
        const dirty = dirtyFields?.[itemId];

        // Item only in ours (new addition by ours)
        if (!b && o && !t) { merged[itemId] = o; continue; }
        // Item only in theirs (new addition by theirs)
        if (!b && !o && t) { merged[itemId] = t; continue; }
        // Item in neither base but in both sides — treat as empty base, merge both additions
        if (!b && o && t) {
            const empty: ItemResult = { status: null, notes: '', photos: [], updatedAt: 0 };
            const sub = mergeOne(empty, o, t, dirty);
            merged[itemId] = sub.item;
            if (sub.conflict) conflicts.push({ ...sub.conflict, itemId });
            continue;
        }
        // Item in base but deleted on both sides — omit from merged
        if (b && !o && !t) { continue; }
        // Item in base + theirs only — theirs wins (ours deleted it; theirs modified it → keep theirs)
        if (b && !o && t)  { merged[itemId] = t; continue; }
        // Item in base + ours only — ours wins
        if (b && o && !t)  { merged[itemId] = o; continue; }

        // All three present.
        // Iter-2 bug #11 — short-circuit when the local user has not edited
        // any field on this item. The server's value (`theirs`) wins
        // wholesale: no diff3, no conflict, no modal noise. Photos and
        // recommendations remain a union since photo-upload pipes already
        // wrote to ours and we don't want to drop them on a no-edit save.
        if (dirty !== undefined && dirty.length === 0) {
            const seen = new Set<string>();
            const photos: ItemResult['photos'] = [];
            for (const p of [...(t.photos || []), ...(o.photos || [])]) {
                if (!seen.has(p.key)) { seen.add(p.key); photos.push(p); }
            }
            const seenRec = new Set<string>();
            const recommendations: ItemResult['recommendations'] = [];
            for (const r of [...(t.recommendations || []), ...(o.recommendations || [])]) {
                if (!seenRec.has(r.recommendationId)) { seenRec.add(r.recommendationId); recommendations.push(r); }
            }
            merged[itemId] = {
                status: t.status,
                notes:  t.notes,
                photos,
                updatedAt: Math.max(o.updatedAt, t.updatedAt),
                ...(recommendations.length > 0 ? { recommendations } : {}),
            };
            continue;
        }

        const sub = mergeOne(b, o, t, dirty);
        merged[itemId] = sub.item;
        if (sub.conflict) conflicts.push({ ...sub.conflict, itemId });
    }

    return { merged, conflicts };
}

function mergeOne(
    base: ItemResult,
    ours: ItemResult,
    theirs: ItemResult,
    dirty?: DirtyField[],
): { item: ItemResult; conflict?: Omit<MergeConflict, 'itemId'> } {
    // Iter-2 bug #11 — when the dirty-fields contract is opted into, only
    // fields the local user actually touched are eligible to flip "ours".
    // For non-dirty fields, theirs wins (or base when theirs absent) without
    // a 3-way merge — that's the entire point of the dirty-field map.
    const statusDirty = isDirty(dirty, 'status');
    const notesDirty  = isDirty(dirty, 'notes');
    const photosDirty = isDirty(dirty, 'photos');
    const recsDirty   = isDirty(dirty, 'recommendations');

    // LWW for status field — only when ours is dirty; otherwise theirs.
    const status = !statusDirty
        ? theirs.status
        : ((ours.updatedAt >= theirs.updatedAt) ? ours.status : theirs.status);

    // Photo union by key (preserve first occurrence order: ours first, then theirs additions)
    const seen = new Set<string>();
    const photos: ItemResult['photos'] = [];
    const photoLeft  = photosDirty ? (ours.photos || [])    : (theirs.photos || []);
    const photoRight = photosDirty ? (theirs.photos || [])  : (ours.photos || []);
    for (const p of [...photoLeft, ...photoRight]) {
        if (!seen.has(p.key)) { seen.add(p.key); photos.push(p); }
    }

    // Recommendations union by recommendationId
    const seenRec = new Set<string>();
    const recommendations: ItemResult['recommendations'] = [];
    const recLeft  = recsDirty ? (ours.recommendations || [])    : (theirs.recommendations || []);
    const recRight = recsDirty ? (theirs.recommendations || [])  : (ours.recommendations || []);
    for (const r of [...recLeft, ...recRight]) {
        if (!seenRec.has(r.recommendationId)) {
            seenRec.add(r.recommendationId);
            recommendations.push(r);
        }
    }

    // diff3 merge for notes — only when ours is dirty; otherwise theirs.
    const notesResult = notesDirty
        ? mergeNotes(base.notes || '', ours.notes || '', theirs.notes || '')
        : { text: theirs.notes || '', conflict: false };
    const item: ItemResult = {
        status,
        notes: notesResult.text,
        photos,
        updatedAt: Math.max(ours.updatedAt, theirs.updatedAt),
        ...(recommendations.length > 0 ? { recommendations } : {}),  // omit field entirely if empty
    };

    if (notesResult.conflict) {
        return {
            item,
            conflict: { field: 'notes', base: base.notes, ours: ours.notes, theirs: theirs.notes },
        };
    }
    return { item };
}

// `ALL_FIELDS` is exported for tests to enumerate the field surface.
export const _ALL_FIELDS: readonly DirtyField[] = ALL_FIELDS;

function mergeNotes(base: string, ours: string, theirs: string): { text: string; conflict: boolean } {
    // Fast-path: identical — no merge needed
    if (ours === theirs)  return { text: ours, conflict: false };
    // Only ours changed
    if (theirs === base)  return { text: ours, conflict: false };
    // Only theirs changed
    if (ours === base)    return { text: theirs, conflict: false };

    // Both sides changed — run diff3
    const blocks = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'));
    let text = '';
    let hasConflict = false;

    for (const blk of blocks) {
        if (blk.ok !== undefined) {
            text += blk.ok.join('\n') + '\n';
        } else if (blk.conflict !== undefined) {
            hasConflict = true;
            // In conflict, keep ours (side `a`) in the merged text; caller surfaces the conflict
            text += (blk.conflict.a || []).join('\n') + '\n';
        }
    }

    return { text: text.replace(/\n$/, ''), conflict: hasConflict };
}
