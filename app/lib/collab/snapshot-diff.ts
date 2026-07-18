/**
 * #181 PR-H (Task H2) — pure projection-diff for the version-compare / field-
 * recovery UI.
 *
 * `diffProjections(from, to)` compares two `inspection_results.data` projections
 * (a snapshot's projection vs the current live state) and returns the per-finding
 * differences. It is the read model behind `VersionCompare.tsx`: each scalar
 * change carries the OLD (`from`) value so the UI can offer "Recover this value"
 * (write the old scalar back into the live Y.Doc).
 *
 * Scope (deliberate):
 *   - The 8 SCALAR fields are diffed PRECISELY (one `FieldChange` per differing
 *     scalar). Same-field offline conflicts are the common recovery case.
 *   - The NESTED containers (attributes / photos / tabs / customComments /
 *     recommendations) are diffed COARSELY: a stable `JSON.stringify` equality
 *     check sets `nestedChanged` plus a short human `nestedSummary` of counts.
 *     There is NO deep per-element diff — nested recovery is handled by whole-
 *     version restore, not per-field recover.
 *
 * Pure, no React, no `any`. Unit-tested in
 * `tests/unit/collab/snapshot-diff.spec.ts`.
 */

import type { ItemEntry, ResultsProjection } from '../../../server/lib/collab/results-doc.types';

/** The 8 precisely-diffed scalar fields of an `ItemEntry`. */
export type ScalarField =
    | 'rating'
    | 'notes'
    | 'value'
    | 'recommendation'
    | 'estimateMin'
    | 'estimateMax'
    | 'followupStatus'
    | 'followupNotes';

/** Fixed list of scalar fields (stable diff order). */
const SCALAR_FIELDS: readonly ScalarField[] = [
    'rating',
    'notes',
    'value',
    'recommendation',
    'estimateMin',
    'estimateMax',
    'followupStatus',
    'followupNotes',
] as const;

/** The nested containers compared coarsely (set membership for the summary). */
const NESTED_FIELDS = ['attributes', 'photos', 'tabs', 'customComments', 'recommendations'] as const;

/** A single scalar field that differs between the two projections. */
interface FieldChange {
    field: ScalarField;
    /** The OLD value (from the `from` projection) — what "Recover" writes back. */
    from: unknown;
    /** The NEW value (from the `to` projection). */
    to: unknown;
}

/** All differences for one finding key. */
export interface FindingDiff {
    findingKey: string;
    /** Present in `to`, absent in `from`. */
    itemAdded?: boolean;
    /** Present in `from`, absent in `to`. */
    itemRemoved?: boolean;
    /** Per-scalar from→to changes (only the differing scalars). */
    scalarChanges: FieldChange[];
    /** True when any nested container differs (coarse JSON compare). */
    nestedChanged: boolean;
    /** Coarse human summary of nested differences, e.g. "photos 2 -> 3". */
    nestedSummary?: string;
}

/**
 * Stable JSON serialization with sorted object keys, so two structurally-equal
 * values compare equal regardless of key insertion order. Arrays keep their
 * order (element order is meaningful for photos/tabs). `undefined` → `null` so a
 * missing field and an explicit `undefined` compare equal.
 */
function stableStringify(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
        out[key] = sortKeys(obj[key]);
    }
    return out;
}

/** Two scalar values are equal iff they stringify identically (handles undefined). */
function scalarEqual(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b);
}

/** Count helper for the nested summary — array length, else 0. */
function lenOf(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
}

/** Count of nested tab/comment entries across the three sub-tabs (coarse). */
function tabCount(value: unknown): number {
    if (value === null || typeof value !== 'object') return 0;
    const obj = value as Record<string, unknown>;
    return lenOf(obj.information) + lenOf(obj.limitations) + lenOf(obj.defects);
}

/** Count of attribute keys (coarse). */
function attrCount(value: unknown): number {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 0;
    return Object.keys(value as Record<string, unknown>).length;
}

/**
 * Build a short human summary of which nested containers changed and by how much
 * (counts only — this is intentionally coarse). Returns undefined when nothing
 * nested changed.
 */
function nestedSummaryFor(from: ItemEntry | undefined, to: ItemEntry | undefined): string | undefined {
    const parts: string[] = [];
    for (const field of NESTED_FIELDS) {
        const fromVal = from?.[field];
        const toVal = to?.[field];
        if (stableStringify(fromVal) === stableStringify(toVal)) continue;

        let fromN: number;
        let toN: number;
        if (field === 'attributes') {
            fromN = attrCount(fromVal);
            toN = attrCount(toVal);
        } else if (field === 'tabs') {
            fromN = tabCount(fromVal);
            toN = tabCount(toVal);
        } else if (field === 'customComments') {
            fromN = tabCount(fromVal);
            toN = tabCount(toVal);
        } else {
            // photos / recommendations — both are arrays.
            fromN = lenOf(fromVal);
            toN = lenOf(toVal);
        }
        parts.push(`${field} ${fromN} -> ${toN}`);
    }
    return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Diff two result projections. Returns one `FindingDiff` per finding key that
 * differs (added / removed / scalar / nested), sorted by finding key. Findings
 * with no difference are omitted.
 */
export function diffProjections(from: ResultsProjection, to: ResultsProjection): FindingDiff[] {
    const keys = new Set<string>([...Object.keys(from), ...Object.keys(to)]);
    const diffs: FindingDiff[] = [];

    for (const findingKey of keys) {
        const fromEntry = from[findingKey];
        const toEntry = to[findingKey];

        const itemAdded = fromEntry === undefined && toEntry !== undefined;
        const itemRemoved = fromEntry !== undefined && toEntry === undefined;

        // Scalar diff — precise, one FieldChange per differing scalar.
        const scalarChanges: FieldChange[] = [];
        for (const field of SCALAR_FIELDS) {
            const fromVal = fromEntry?.[field];
            const toVal = toEntry?.[field];
            if (!scalarEqual(fromVal, toVal)) {
                scalarChanges.push({ field, from: fromVal, to: toVal });
            }
        }

        // Nested diff — coarse: did any nested container's stable JSON change?
        let nestedChanged = false;
        for (const field of NESTED_FIELDS) {
            if (stableStringify(fromEntry?.[field]) !== stableStringify(toEntry?.[field])) {
                nestedChanged = true;
                break;
            }
        }

        const hasChange =
            itemAdded || itemRemoved || scalarChanges.length > 0 || nestedChanged;
        if (!hasChange) continue;

        const diff: FindingDiff = {
            findingKey,
            scalarChanges,
            nestedChanged,
        };
        if (itemAdded) diff.itemAdded = true;
        if (itemRemoved) diff.itemRemoved = true;
        if (nestedChanged) {
            const summary = nestedSummaryFor(fromEntry, toEntry);
            if (summary) diff.nestedSummary = summary;
        }
        diffs.push(diff);
    }

    diffs.sort((a, b) => (a.findingKey < b.findingKey ? -1 : a.findingKey > b.findingKey ? 1 : 0));
    return diffs;
}
