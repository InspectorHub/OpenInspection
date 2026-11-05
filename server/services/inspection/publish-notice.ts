/**
 * The client notice a publish raises, and the one choice the publisher has over it.
 *
 * A first publish fires `report.published`, a re-publish fires `report.amended`; who is told is the workspace's
 * automation rules' call. The publisher's only say is `notifyClient`, and only on an AMENDMENT: a re-publish of a
 * report that was reopened with "Edit and republish" (published once, links still live). A report that was retracted has
 * no `published_at`, so its re-publish is a fresh delivery and is decided by the rules like a first publish.
 *
 * The choice gates the whole report-updated trigger, not one recipient: unticked, NO report-updated rule fires (the
 * client's, the buyer's agent's, a custom or in-app one); ticked, they all do. That is why it is worded as sending "the
 * report-updated notices" and not as "notify the client".
 *
 * A suppressed amendment fires nothing and stamps no `notified_at`, so it neither delays nor coalesces a later delivery.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { reports } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { reportEditState } from '../../lib/inspection/report-lock';
import { lastSiblingNotifiedAt, markReportNotified, shouldCoalesceNotification } from '../../lib/inspection/report-notifications';
import { fireAutomation, resolvePublishTrigger } from './shared';

/** Read BEFORE the publish flips the report: is it open for editing again? */
export async function wasReopenedForEditing(db: DrizzleD1Database, tenantId: string, reportId: string | null): Promise<boolean> {
    if (!reportId) return false;
    const row = await db.select({ status: reports.status, publishedAt: reports.publishedAt }).from(reports)
        .where(and(eq(reports.id, reportId), eq(reports.tenantId, tenantId))).get();
    return row ? reportEditState(row) === 'editing' : false;
}

/** Raises (or deliberately does not raise) the notice for a publish that has just happened. Returns whether it was an amendment. */
export async function announcePublish(args: {
    db: DrizzleD1Database;
    rawDb: D1Database;
    tenantId: string;
    inspectionId: string;
    reportId: string | null;
    now: Date;
    wasReopened: boolean;
    notifyClient: boolean;
}): Promise<{ amendment: boolean }> {
    const { db, rawDb, tenantId, inspectionId, reportId, now } = args;
    // Reopened = published once and links still live, whether or not a version row was ever written for it (an older
    // report can lack one). Such a publish is an amendment and fires `report.amended`; otherwise a prior version row for
    // THIS report makes it one. Awaited so the automation log rows exist before the response goes out.
    const amendment = args.wasReopened;
    const trigger = amendment ? 'report.amended' : await resolvePublishTrigger(rawDb, tenantId, inspectionId, reportId ?? undefined);
    if (amendment && !args.notifyClient) {
        logger.info('amendment published without notifying the client', { inspectionId, reportId });
        return { amendment };
    }
    // An AMENDMENT is never coalesced: "your report changed" is its own thing to say.
    const coalesced = !amendment && trigger === 'report.published' && shouldCoalesceNotification(
        reportId ? await lastSiblingNotifiedAt(db, tenantId, inspectionId, reportId) : null, now.getTime());
    if (coalesced) {
        logger.info('report notification coalesced into a sibling delivery', { inspectionId, reportId });
    } else {
        await fireAutomation(rawDb, tenantId, inspectionId, trigger, reportId ?? undefined);
        if (reportId) await markReportNotified(db, tenantId, reportId, now);
    }
    return { amendment };
}
