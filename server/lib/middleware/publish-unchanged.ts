import type { Context, Next } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { reportVersions } from '../db/schema';
import { PublishInspectionSchema } from '../validations/inspection.schema';
import { getDrizzle } from '../route-helpers';
import { relockUnchangedReport } from '../inspection/report-lock';
import { flushCollabDocs, setCollabDocLocks } from '../collab/doc-lock-notify';
import { resolveTenantSlug } from '../url';
import { REPORT_STATUS } from '../status/report-status';
import { logger } from '../logger';
import { compareSnapshots } from '../snapshot-compare';
import type { HonoConfig } from '../../types/hono';

/**
 * A publish with nothing changed since the latest published version answers with that version
 * instead of making a new one. "Nothing changed" is decided before the publish does anything:
 * what a publish would freeze right now holds the same content as what the latest version froze (see `compareSnapshots`: object key order does not count; the
 * snapshot carries the report status, so an unpublish in between breaks the match), and the
 * `summary` is the one that version carries. A translation request is never a duplicate. The
 * answer is the normal publish shape for the existing version, and none of the publish work runs:
 * no status change, automation, audit row, translation, PDF, notification or ISN sync (`isnSync`
 * is null because none was attempted), plus `unchangedSinceVersion`: the version still current, which is how a caller tells this answer from a real publish. A version frozen before its snapshot matched this shape
 * simply does not match, so the next publish is a real one.
 */
/** The version number the report still stands at when nothing changed, or null when a publish would change something. */
async function unchangedSinceVersion(c: Context<HonoConfig>, id: string, reportIdInBody: string | undefined, summary: string | undefined): Promise<number | null> {
    const tenantId = c.get('tenantId');
    const versions = c.var.services.reportVersion;
    const db = getDrizzle(c);
    const reportId = await versions.resolveReportId(db, tenantId, id, reportIdInBody);
    // What the inspector typed in the last second may still be in the live document, not yet in the database this check reads: ask the
    // document to store it first, or "nothing changed" would be answered, the report locked, and the typed note stranded.
    if (reportId) await flushCollabDocs(c.env, tenantId, [reportId]);
    const latest = await db.select().from(reportVersions)
        .where(and(
            eq(reportVersions.tenantId, tenantId),
            reportId ? eq(reportVersions.reportId, reportId) : eq(reportVersions.inspectionId, id),
        ))
        .orderBy(desc(reportVersions.versionNumber))
        .limit(1)
        .get();
    if (!latest || latest.summary !== (summary ?? null)) return null;
    const fresh = await versions.buildSnapshotForCheck(tenantId, id, reportId);
    const cmp = compareSnapshots(latest.snapshotJson, fresh);
    if (cmp.same) return latest.versionNumber;
    // Names only, so the next time a publish that should have been "unchanged" is not, the log says which parts moved.
    logger.info('publish is not unchanged: the frozen copy differs', { inspectionId: id, reportId, version: latest.versionNumber, differs: cmp.differs });
    return null;
}

export async function answerUnchangedPublish(c: Context<HonoConfig>, next: Next) {
    const body = PublishInspectionSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success || body.data.translateTo) return next();
    const id = c.req.param('id') ?? '';
    // A comparison that cannot be made is never a reason to refuse a publish: publish as usual.
    const since = await unchangedSinceVersion(c, id, body.data.reportId, body.data.summary).catch(() => null);
    if (since === null) return next();
    // A report that was being edited again and came back identical is published again: no new version, but the lock returns.
    const tenantId = c.get('tenantId');
    await relockUnchangedReport(getDrizzle(c), tenantId, id, body.data.reportId);
    await setCollabDocLocks(c.env, getDrizzle(c), tenantId, id, true, body.data.reportId ? { reportId: body.data.reportId } : { primary: true });
    const reportUrl = `/report/${await resolveTenantSlug(c, tenantId)}/${id}`;
    return c.json({ success: true as const, data: { reportUrl, reportStatus: REPORT_STATUS.PUBLISHED, isnSync: null, unchangedSinceVersion: since } }, 200);
}
