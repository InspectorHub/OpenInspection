/**
 * Which document is being rendered, and what its render inputs hash to.
 *
 * Extracted from `inspection-report.service.ts` with NO behaviour change, so
 * the change that follows is reviewable against a clean base. Both pieces below
 * are the code that was there, moved.
 *
 * Kept in its own module rather than left in that service for two reasons, and
 * neither is tidiness: the service sits at its large-file cap with no headroom,
 * and which results row a render is reading is the one decision in the render
 * path that a reader should be able to find without walking nine hundred lines
 * of payload assembly.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults } from '../../lib/db/schema';
import { sha256Hex } from '../signing-key.service';
import { RENDER_VERSION } from '../../lib/pdf';

/** Any drizzle handle the render path holds. Structural, so tests can pass theirs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = DrizzleD1Database<any>;

/**
 * The `inspection_results` row a render reads.
 *
 * ⚠️ Inspection-grained, and that is a defect rather than a decision.
 * `inspection_results.report_id` carries `uq_results_report`, so an inspection
 * delivering several reports has several rows and this `.get()` returns
 * whichever the driver hands over first. Moved as-is; repaired next.
 */
export async function resolveResultsRow(
    db: Db,
    tenantId: string,
    inspectionId: string,
) {
    return db
        .select()
        .from(inspectionResults)
        .where(and(
            eq(inspectionResults.inspectionId, inspectionId),
            eq(inspectionResults.tenantId, tenantId),
        ))
        .get();
}

/**
 * A stable content hash over the render inputs for a report.
 *
 * Used to skip Browser Rendering when an identical PDF is already cached, and
 * as the freshness basis a stored courtesy translation is checked against.
 *
 * Photo URLs use the raw R2 key (no volatile render/auth token) so the hash is
 * stable across token refreshes. Template CSS and layout changes are covered by
 * bumping `RENDER_VERSION`.
 *
 * Branding (logo image, primary colour) is NOT included: it is not part of the
 * report payload, and branding changes are covered by `RENDER_VERSION` too.
 *
 * ⚠️ This is NOT the report signature basis. `report_versions.content_hash` is
 * a digest over the publish SNAPSHOT and is what the Ed25519 signature covers
 * (`report-version.service.ts`); it is computed and stored independently. So a
 * change to what goes into the basis here re-renders cached PDFs once — it
 * cannot invalidate a signature.
 */
export async function reportContentHash(data: unknown): Promise<string> {
    return sha256Hex(JSON.stringify({ v: RENDER_VERSION, data }));
}
