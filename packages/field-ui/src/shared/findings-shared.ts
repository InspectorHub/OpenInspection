export interface CustomCommentEntry {
  id: string;
  title: string;
  comment: string;
  included: boolean;
  category?: string;
  location?: string;
  photos?: Array<{ key: string }>;
}

/**
 * A repair item (Recommendation) snapshotted onto a finding. Stored under
 * `result.recommendations[]`. The aggregate read endpoint
 * (`GET /api/inspections/:id/recommendations`) keys on `recommendationId`.
 * Summary and contractor type are snapshotted at attach time so later catalog
 * edits never silently rewrite a published finding.
 *
 * There is no estimate here, and that is the point: this type is what the
 * editor is ABLE to write onto an inspection, and a repair price is not
 * something the product produces. `RepairItemSnapshot` (the persisted shape, in
 * packages/field-ui/src/shared/results-doc.types.ts) still tolerates the estimate keys on
 * findings written before they were removed; nothing writes them now.
 */
export interface AttachedRepairItem {
  recommendationId: string;
  summarySnapshot: string;
  contractorTypeSnapshot: string | null;
  attachedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

export function cloneByScope(
    src: Record<string, unknown>,
    scope: 'rating' | 'rating_notes' | 'all',
): Record<string, unknown> {
    if (scope === 'all') return { ...src };
    if (scope === 'rating_notes') {
        const next: Record<string, unknown> = {};
        if ('rating' in src) next.rating = src.rating;
        if ('notes' in src)  next.notes  = src.notes;
        return next;
    }
    const next: Record<string, unknown> = {};
    if ('rating' in src) next.rating = src.rating;
    return next;
}
