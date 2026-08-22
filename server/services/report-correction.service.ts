/**
 * Correcting a report that has already been delivered.
 *
 * A published report is signed and hash-chained, and people rely on the copy
 * they were given. Rewriting it in place would destroy the difference between
 * HISTORICAL AUTHENTICITY — what was delivered, and that it verifies — and
 * CURRENT CORRECTNESS, which is what a correction is about. So a correction
 * publishes a NEW version through the amendment machinery that already exists
 * (`ReportVersionService.snapshotOnPublish`: `isAmendment` for v >= 2,
 * `prevHash` chaining to the previous content hash, `summary` carrying the
 * reason) and never touches the row it supersedes.
 *
 * The correction is not finished when one row changes. The stored deliverables
 * for the same inspection — the signed PDF, the certificate and the evidence
 * zip — are still being served, so they stop describing themselves as current
 * the moment the amendment lands. That is `resolveArtifactStatus`, read by the
 * three download helpers; nothing here has to stamp the objects.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections, reportVersions } from '../lib/db/schema';
import { assertNothingDeferred } from '../lib/artifact-status';
import {
    CorrectReportSchema,
    correctionRequiresValue,
    type CorrectReportInput,
} from '../lib/validations/correction.schema';
import { ReportVersionService } from './report-version.service';
import { logger } from '../lib/logger';

export interface CorrectionResult {
    /** The version the correction published. Always >= 2. */
    versionNumber: number;
    /** The version it supersedes — still readable, still verifying. */
    supersedes: number;
}

export async function correctReport(
    d1: D1Database,
    encryptionSecret: string,
    input: CorrectReportInput,
): Promise<CorrectionResult> {
    const parsed = CorrectReportSchema.parse(input);

    // Before anything is written. A correction that has already published half
    // of itself and then refuses is worse than one that never started.
    assertNothingDeferred(parsed.deferKeys ?? []);

    const value = parsed.to.trim();
    if (!value && correctionRequiresValue(parsed.field)) {
        throw new Error(`A correction may not leave ${parsed.field} empty.`);
    }

    const db = drizzle(d1);
    const row = await db.select({ id: inspections.id })
        .from(inspections)
        .where(and(
            eq(inspections.id, parsed.inspectionId),
            eq(inspections.tenantId, parsed.tenantId),
        ))
        .get();
    if (!row) throw new Error('Inspection not found');

    const versions = new ReportVersionService(d1, encryptionSecret);

    // Snapshot the pre-correction state FIRST when nothing was ever published.
    //
    // Two reasons, and the second is the load-bearing one. A correction is a
    // statement that what was delivered was wrong, which is only meaningful
    // against a record of what was delivered. And `isAmendment` is derived
    // from the version number, so a correction that landed as version 1 would
    // not read as an amendment at all — the deliverables would go on calling
    // themselves current, and the correction would be invisible to every
    // reader downstream of it.
    const existing = await db.select({ versionNumber: reportVersions.versionNumber })
        .from(reportVersions)
        .where(and(
            eq(reportVersions.tenantId, parsed.tenantId),
            eq(reportVersions.inspectionId, parsed.inspectionId),
        ))
        .limit(1)
        .get();
    if (!existing) {
        await versions.snapshotOnPublish(parsed.tenantId, parsed.inspectionId, parsed.correctedBy);
    }

    await db.update(inspections)
        .set({ [parsed.field]: value || null })
        .where(and(
            eq(inspections.id, parsed.inspectionId),
            eq(inspections.tenantId, parsed.tenantId),
        ));

    const published = await versions.snapshotOnPublish(
        parsed.tenantId,
        parsed.inspectionId,
        parsed.correctedBy,
        parsed.reason,
    );

    logger.info('report.corrected', {
        tenantId: parsed.tenantId,
        inspectionId: parsed.inspectionId,
        // The field NAME, never the old or new value: the value is the
        // personal data the correction is about.
        field: parsed.field,
        versionNumber: published.versionNumber,
    });

    return { versionNumber: published.versionNumber, supersedes: published.versionNumber - 1 };
}
