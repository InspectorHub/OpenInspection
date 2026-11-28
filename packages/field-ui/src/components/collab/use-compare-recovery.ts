import { useCallback } from "react";
import type * as Y from "yjs";
import { applyItemPatch } from "../../shared/results-doc";
import type { FindingDiff, ScalarField } from "../../shared/snapshot-diff";

/**
 * The per-value recovery shared by the version-history Compare flow and the
 * #478 discarded-copy review: one helper covers both, so the set of fields a
 * recovery may write back can never drift between the two.
 *
 * `recoverField` writes the OLD scalar into the LIVE doc (via `applyItemPatch`,
 * the same write the editor itself makes) and reports whether it wrote. The
 * caller prunes the recovered row from its own diff list with
 * `pruneRecoveredField`, so the row disappears at once instead of waiting for
 * the live doc binding to catch up.
 */

/** The scalar fields written via `applyItemPatch`; guards the recover write.
 *  No estimateMin / estimateMax: recovering an old version must not be a way to
 *  put a repair price back into a live document. */
const SCALAR_FIELD_SET = new Set<ScalarField>([
    "rating",
    "notes",
    "value",
    "recommendation",
    "followupStatus",
    "followupNotes",
]);

export function useCompareRecovery(doc: Y.Doc | null | undefined): {
    /** Write the old scalar into the live doc; false when there is no doc or the field is not recoverable. */
    recoverField: (findingKey: string, field: string, value: unknown) => boolean;
} {
    const recoverField = useCallback(
        (findingKey: string, field: string, value: unknown): boolean => {
            if (!doc) return false;
            if (!SCALAR_FIELD_SET.has(field as ScalarField)) return false;
            applyItemPatch(doc, findingKey, field as ScalarField, value);
            return true;
        },
        [doc],
    );
    return { recoverField };
}

/** Drop the recovered field from a diff list, dropping findings left with no changes. */
export function pruneRecoveredField(diffs: FindingDiff[], findingKey: string, field: string): FindingDiff[] {
    return diffs
        .map((d) =>
            d.findingKey === findingKey
                ? { ...d, scalarChanges: d.scalarChanges.filter((c) => c.field !== field) }
                : d,
        )
        .filter((d) => d.scalarChanges.length > 0 || d.nestedChanged || d.itemAdded || d.itemRemoved);
}
