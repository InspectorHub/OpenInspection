/**
 * Comparing the D1 results blob with the live document's projection.
 *
 * When a results document already has stored collab state, the Durable Object
 * deliberately does not import the D1 blob on top of it: the document is
 * authoritative, and a stale blob would clobber unflushed edits. That rule has
 * a blind spot. If something rewrote the blob behind the document's back (a
 * direct write that bypassed the object), the two now disagree, and the next
 * persist replaces the blob with the document's projection. Nothing says so.
 *
 * `logDivergence` is the "says so" half: a log-only check, run on that one
 * branch, that counts how many findings carry a rating or notes in the blob
 * while the document has neither. It changes nothing and never throws.
 */

import type * as Y from 'yjs';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspectionResults } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { projectResults } from '@core/field-ui/shared/results-doc';
import { isMetaKey } from '@core/field-ui/shared/finding-key';
import type { ResultsProjection } from '@core/field-ui/shared/results-doc.types';

/**
 * Narrow a D1 `inspection_results.data` json value to a non-empty projection.
 * The column is `text({ mode: 'json' })`, so drizzle returns the parsed value
 * as `unknown`. Empty / null / non-object / `{}` blobs are not worth importing
 * (an empty doc projects to `{}`), so the guard rejects them.
 */
export function isNonEmptyProjection(value: unknown): value is ResultsProjection {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length > 0
    );
}

/**
 * Stable deep-equality for two result projections. `projectResults` emits a
 * plain, JSON-serialisable object with a deterministic key/element order (Yjs
 * iteration order is insertion order, which is stable across reads of the same
 * doc), so a `JSON.stringify` compare is both correct and cheap here. Used by
 * the connect-time dedup to skip a no-op snapshot when nothing changed since the
 * last capture.
 */
export function projectionsEqual(a: ResultsProjection, b: ResultsProjection): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function hasText(value: unknown): boolean {
    return typeof value === 'string' && value.length > 0;
}

/**
 * How many findings in `blob` have a non-empty rating or notes while
 * `projection` has no entry for the same key, or an entry with neither.
 *
 * Meta keys (such as the inspector signature) are not
 * findings and are never counted. A blob that is not a plain object counts as
 * zero.
 */
export function countDivergentFindings(blob: unknown, projection: ResultsProjection): number {
    if (typeof blob !== 'object' || blob === null || Array.isArray(blob)) return 0;

    let divergent = 0;
    for (const [key, raw] of Object.entries(blob)) {
        if (isMetaKey(key)) continue;
        if (typeof raw !== 'object' || raw === null) continue;
        const stored = Object.fromEntries(Object.entries(raw));
        if (!hasText(stored.rating) && !hasText(stored.notes)) continue;

        const live = projection[key];
        if (!live || (!hasText(live.rating) && !hasText(live.notes))) divergent += 1;
    }
    return divergent;
}

interface DivergenceTarget { tenantId: string; inspectionId: string; reportId: string | null }

/**
 * The blob to compare against. An inspection has one results row per report, and
 * the hydration read takes whichever row it reaches first, so when the document's
 * report is known its own row is read instead (a plain tenant-scoped read, no
 * side effect). A known report with no row has nothing to diverge from. Without a
 * report id the hydration blob is all there is, and on an inspection with several
 * reports the count may then describe a sibling's row.
 */
async function blobForReport(d1: D1Database, target: DivergenceTarget, hydrationBlob: unknown): Promise<unknown> {
    if (!target.reportId) return hydrationBlob;
    const row = await drizzle(d1)
        .select({ data: inspectionResults.data })
        .from(inspectionResults)
        .where(and(eq(inspectionResults.tenantId, target.tenantId), eq(inspectionResults.reportId, target.reportId)))
        .get();
    return row?.data ?? null;
}

/**
 * Log one `collab_d1_divergence` warning when the blob and the document
 * disagree. The line carries the inspection id and a count, never a key, a
 * note or any tenant data. A diagnostic must not break the hydration it rides
 * on, so every failure is swallowed.
 */
export async function logDivergence(d1: D1Database, target: DivergenceTarget, hydrationBlob: unknown, doc: Y.Doc): Promise<void> {
    try {
        const blob = await blobForReport(d1, target, hydrationBlob);
        const divergentFindings = countDivergentFindings(blob, projectResults(doc));
        if (divergentFindings > 0) logger.warn('collab_d1_divergence', { inspectionId: target.inspectionId, divergentFindings });
    } catch {
        // Log-only: nothing to recover and nothing to report.
    }
}
