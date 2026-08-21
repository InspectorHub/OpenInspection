import { drizzle } from 'drizzle-orm/d1';
import { logger } from '../logger';
import type { EmailServiceEnv } from '../email/build-email-service';

/**
 * What the 04:00 tick does, separated from the schedule that decides when.
 *
 * Two jobs, each in its own try/catch, because they fail for unrelated reasons
 * and one falling over must not take the other with it. A sweep DELETES on a
 * fixed platform window; a reminder WRITES about a window that has not closed
 * yet. Putting them in one handler would mean the day a bucket binding is
 * missing is also the day nobody is told their import is about to go.
 *
 * The caller owns the clock. This module is asked to do the work and reports
 * what it did, so it can be run on demand without waiting for four in the
 * morning.
 */
/**
 * Everything the 04:00 tick needs.
 *
 * It is an `EmailServiceEnv` and not just a database, because the reminder half
 * SENDS: the recipient of an expiry notice may not have signed in for weeks, so
 * it goes out as email built for that tenant rather than as a row in a feed
 * they are not reading. `ScheduledEnv` already satisfies this shape.
 */
export interface DailyRetentionEnv extends EmailServiceEnv {
    PHOTOS?: R2Bucket | undefined;
}

export async function runDailyRetentionTasks(env: DailyRetentionEnv, at: Date): Promise<void> {
    try {
        const { runLogRetentionSweep } = await import('../compliance/retention-logs');

        // PHOTOS is passed because one rule now reaches outside D1:
        // `report_pdfs` deletes an R2 object and its row together, and it
        // REFUSES to run without a bucket rather than deleting rows that point
        // at objects nothing else could ever reach. On a deployment with no
        // PHOTOS binding the whole sweep throws into the catch below and logs —
        // which is correct and loud, rather than a sweep that quietly expires
        // everything except the one store this task exists to expire.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sweepDb = drizzle(env.DB) as any;
        const logSummary = await runLogRetentionSweep(
            sweepDb, at.getTime(), { photos: env.PHOTOS },
        );
        // Counts only — the summary carries table names and integers, never a
        // row. Silent on a no-op run, which is the steady state.
        if (logSummary.total > 0) {
            logger.info('[cron] log retention sweep', logSummary);
        }
    } catch (e) {
        // A RetentionSweepError carries the PARTIAL summary: every rule that did
        // run, and the ones that did not. Logging only the message would erase
        // the record of what expired successfully, which is a worse report than
        // the one it replaces.
        const { RetentionSweepError } = await import('../compliance/retention-logs');
        const partial = e instanceof RetentionSweepError
            ? { failures: e.failures, ...e.summary }
            : {};
        logger.error('[cron] log retention sweep failed', partial, e instanceof Error ? e : undefined);
    }

    try {
        const { MigrationAssistanceService } = await import('../../services/migration-intake/assistance.service');
        const reminders = await new MigrationAssistanceService(env).remindExpiring(at);
        // All THREE numbers, always — including on a pass that reminded nobody.
        // A line that only appeared when something happened could not tell a
        // quiet day from a job that had stopped looking, and this one has no
        // other witness. `scanned` separates the two: a pass that examined
        // nothing and a pass that found nothing due are different events.
        logger.info('[cron] migration intake expiry reminders', reminders);
    } catch (e) {
        logger.error(
            '[cron] migration intake expiry reminders failed', {},
            e instanceof Error ? e : undefined,
        );
    }
}
