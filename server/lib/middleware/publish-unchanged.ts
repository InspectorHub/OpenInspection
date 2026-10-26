import type { Context, Next } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { reportVersions } from '../db/schema';
import { PublishInspectionSchema } from '../validations/inspection.schema';
import { getDrizzle } from '../route-helpers';
import { resolveTenantSlug } from '../url';
import { REPORT_STATUS } from '../status/report-status';
import type { HonoConfig } from '../../types/hono';

/**
 * A publish with nothing changed since the latest published version answers with that version
 * instead of making a new one. "Nothing changed" is decided before the publish does anything:
 * what a publish would freeze right now is byte-identical to what the latest version froze (the
 * snapshot carries the report status, so an unpublish in between breaks the match), and the
 * `summary` is the one that version carries. A translation request is never a duplicate. The
 * answer is the normal publish shape for the existing version, and none of the publish work runs:
 * no status change, automation, audit row, translation, PDF, notification or ISN sync (`isnSync`
 * is null because none was attempted). A version frozen before its snapshot matched this shape
 * simply does not match, so the next publish is a real one.
 */
async function isUnchanged(c: Context<HonoConfig>, id: string, reportIdInBody: string | undefined, summary: string | undefined): Promise<boolean> {
    const tenantId = c.get('tenantId');
    const versions = c.var.services.reportVersion;
    const db = getDrizzle(c);
    const reportId = await versions.resolveReportId(db, tenantId, id, reportIdInBody);
    const latest = await db.select().from(reportVersions)
        .where(and(
            eq(reportVersions.tenantId, tenantId),
            reportId ? eq(reportVersions.reportId, reportId) : eq(reportVersions.inspectionId, id),
        ))
        .orderBy(desc(reportVersions.versionNumber))
        .limit(1)
        .get();
    if (!latest || latest.summary !== (summary ?? null)) return false;
    return latest.snapshotJson === await versions.buildSnapshotJson(tenantId, id);
}

export async function answerUnchangedPublish(c: Context<HonoConfig>, next: Next) {
    const body = PublishInspectionSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success || body.data.translateTo) return next();
    const id = c.req.param('id') ?? '';
    // A comparison that cannot be made is never a reason to refuse a publish: publish as usual.
    if (!await isUnchanged(c, id, body.data.reportId, body.data.summary).catch(() => false)) return next();
    const reportUrl = `/report/${await resolveTenantSlug(c, c.get('tenantId'))}/${id}`;
    return c.json({ success: true as const, data: { reportUrl, reportStatus: REPORT_STATUS.PUBLISHED, isnSync: null } }, 200);
}
