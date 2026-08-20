import { drizzle } from 'drizzle-orm/d1';
import { and, eq, gt, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { migrationBatches, users } from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS } from '../../lib/status/migration-batch-status';
import { ROLE } from '../../lib/auth/roles';
import {
    MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS,
    MIGRATION_INTAKE_FIRST_REMINDER_LEAD_DAYS,
    MIGRATION_INTAKE_REMINDER_LEAD_DAYS,
    MIGRATION_INTAKE_STAGED_RETENTION_DAYS,
} from '../../lib/compliance/retention-windows';
import { buildTenantEmailService, type EmailServiceEnv } from '../../lib/email/build-email-service';
import type { EmailService } from '../email.service';
import { logger } from '../../lib/logger';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The two marks that keep each reminder to one.
 *
 * On the manifest rather than in columns of their own: the manifest is already
 * the one JSON payload this table carries, and two boolean columns would make
 * every reader of the schema ask what they are before concluding they are marks
 * on a cron job.
 *
 * TWO keys and not one timestamp, because they answer different questions. A
 * single "reminded at" could not tell a run that has had its first reminder
 * from one that has had both, so the second would either never fire or fire
 * every day.
 *
 * Module-private. The spec asserts the literal strings instead of importing
 * these, on purpose: the key names are a stored wire format that outlives any
 * one reader, and a test that imported the constant would agree with a rename
 * that silently orphaned every mark already written.
 */
const INTAKE_REMINDER_FIRST_KEY = 'intakeReminderFirstSentAt';
const INTAKE_REMINDER_FINAL_KEY = 'intakeReminderFinalSentAt';

/**
 * When a run created — or finished — now stops being kept.
 *
 * Two windows, and which one applies is a property of the run: one waiting on a
 * person is on OUR clock, one the operator staged is on theirs.
 */
export function expiryFor(isAssisted: boolean, now: Date): Date {
    const days = isAssisted
        ? MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS
        : MIGRATION_INTAKE_STAGED_RETENTION_DAYS;
    return new Date(now.getTime() + days * DAY_MS);
}

/** Statuses a run can still be usefully reminded about. A finished run has nothing at stake. */
const REMINDABLE = [
    MIGRATION_BATCH_STATUS.STAGED,
    MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE,
];

/** The sweep's own outcome. All three numbers are reported, always — see `remindExpiring`. */
export interface ExpiryReminderSummary {
    /** Unfinished runs with a clock inside the reminder horizon this pass looked at. */
    scanned: number;
    /** How many got the earlier, still-time-to-act reminder. */
    firstReminded: number;
    /** How many got the week-out one that reports the file is about to go. */
    finalReminded: number;
}

/**
 * The messages an import run sends, and the marks that keep each to one.
 *
 * Email, every one of them, and no in-app twin. The recipient is someone in the
 * middle of moving in — exactly when they are not yet signing in daily — so a
 * notice that lives on a screen they have not opened is not a notice. There is
 * also no fallback to another channel: if the email path is not working the
 * message is not sent and the failure is logged. A person who gave us an email
 * address does not get a text about a file.
 */
export class MigrationAssistanceService {
    constructor(private env: EmailServiceEnv) {}

    private getDrizzle() {
        return drizzle(this.env.DB);
    }

    /**
     * The tenant's own email service, built for that tenant.
     *
     * A seam rather than a direct call so the reminder sweep can be tested
     * without a provider: overriding this is how a test says "pretend the mail
     * path exists" without also pretending the batch query does.
     */
    mailerFor(tenantId: string): Promise<EmailService> {
        return buildTenantEmailService(this.env, tenantId);
    }

    /**
     * The addresses of the people who can act on an import.
     *
     * Owners and managers, because those are the roles the imports screen is
     * open to; an inspector who received this could not open the link. Removed
     * users are excluded — a `deleted_at` row is a person who is not here.
     */
    private async recipients(tenantId: string): Promise<string[]> {
        const rows = await this.getDrizzle().select({ email: users.email })
            .from(users)
            .where(and(
                eq(users.tenantId, tenantId),
                inArray(users.role, [ROLE.OWNER, ROLE.MANAGER]),
                isNull(users.deletedAt),
            ))
            .all();
        return rows.map((r) => r.email);
    }

    private importLink(batchId: string): string {
        const base = (this.env.APP_BASE_URL ?? '').replace(/\/$/, '');
        return `${base}/settings/imports/${batchId}`;
    }

    /**
     * Runs one send and answers how many people it reached.
     *
     * A provider failure is logged and reported as zero rather than thrown: the
     * thing this message is about has already happened, and a throw here would
     * roll a caller back over a message. Zero is the honest number, and the log
     * is what makes "nobody was told" findable.
     */
    private async deliver(
        tenantId: string,
        what: string,
        send: (to: string[]) => Promise<void>,
    ): Promise<number> {
        const to = await this.recipients(tenantId);
        if (to.length === 0) {
            logger.warn('[migration-intake] nobody to notify', { tenantId, what });
            return 0;
        }
        try {
            await send(to);
            return to.length;
        } catch (err) {
            logger.error(
                '[migration-intake] notification not delivered',
                { tenantId, what, recipients: to.length },
                err instanceof Error ? err : undefined,
            );
            return 0;
        }
    }

    /** Acknowledged within two working days, so silence becomes findable. */
    async notifyReceived(email: EmailService, tenantId: string, batchId: string): Promise<number> {
        return this.deliver(tenantId, 'received', (to) =>
            email.sendMigrationImportReceived(to, this.importLink(batchId)));
    }

    /**
     * Tells the workspace a converted file has landed and the run is theirs to
     * review.
     *
     * They press apply, not us. What arrives is a plan they can read before
     * anything is written — the difference between this and inserting rows into
     * somebody's workspace on their behalf.
     */
    async notifyDelivered(email: EmailService, tenantId: string, batchId: string): Promise<number> {
        return this.deliver(tenantId, 'ready', (to) =>
            email.sendMigrationImportReady(to, this.importLink(batchId)));
    }

    /**
     * A refusal is a conclusion somebody reached, not a clock running out.
     *
     * The batch id is taken and not used: this message carries no link, because
     * the run is over and a button would imply there is something to do on that
     * screen. The parameter stays so every notify method on this service is
     * called the same way, and so the caller is not the one deciding which
     * outcome gets a link.
     */
    async notifyDeclined(
        email: EmailService,
        tenantId: string,
        _batchId: string,
        reason: string,
    ): Promise<number> {
        return this.deliver(tenantId, 'declined', (to) =>
            email.sendMigrationImportDeclined(to, reason));
    }

    /**
     * Up to two reminders per run, in the weeks before it stops being kept.
     *
     * The first, a month out, still leaves room to act. The second, a week out,
     * reports that the file is about to go. A run the operator merely staged
     * gets only the second — its whole window is as long as the first
     * reminder's lead, so a first reminder would fire the day it was created.
     *
     * Returns THREE numbers. A pass that examined nothing and a pass that found
     * nothing due produce the same silence otherwise, and the first of those is
     * a broken job.
     */
    async remindExpiring(now: Date): Promise<ExpiryReminderSummary> {
        const db = this.getDrizzle();
        const horizon = new Date(now.getTime() + MIGRATION_INTAKE_FIRST_REMINDER_LEAD_DAYS * DAY_MS);

        const candidates = await db.select({
            id: migrationBatches.id,
            tenantId: migrationBatches.tenantId,
            status: migrationBatches.status,
            manifest: migrationBatches.manifest,
            expiresAt: migrationBatches.expiresAt,
        })
            .from(migrationBatches)
            .where(and(
                inArray(migrationBatches.status, REMINDABLE),
                isNotNull(migrationBatches.expiresAt),
                lte(migrationBatches.expiresAt, horizon),
                // Already past its date is the sweep's business. A reminder
                // about something that has gone is worse than none.
                gt(migrationBatches.expiresAt, now),
            ))
            .all();

        let firstReminded = 0;
        let finalReminded = 0;

        for (const batch of candidates) {
            const expiresAt = batch.expiresAt as Date;
            const daysLeft = (expiresAt.getTime() - now.getTime()) / DAY_MS;
            const manifest = JSON.parse(batch.manifest) as Record<string, unknown>;

            const inFinalWindow = daysLeft <= MIGRATION_INTAKE_REMINDER_LEAD_DAYS;
            const wantsFinal = inFinalWindow && !manifest[INTAKE_REMINDER_FINAL_KEY];
            // The first reminder is for a run waiting on US, and only while
            // there is still room to act. `!wantsFinal` alone is NOT the
            // condition: once inside the final window with the final mark
            // already written, that reads as "the first one is still owed" and
            // sends "you have a month" the day after "you have a week". The
            // window has to be tested, not inferred from the other branch.
            const wantsFirst = !inFinalWindow
                && batch.status === MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE
                && !manifest[INTAKE_REMINDER_FIRST_KEY];
            if (!wantsFinal && !wantsFirst) continue;

            const email = await this.mailerFor(batch.tenantId);
            const sent = await this.deliver(batch.tenantId, 'expiring', (to) =>
                email.sendMigrationImportExpiring(to, {
                    importLink: this.importLink(batch.id),
                    expiresOn: expiresAt.toISOString().slice(0, 10),
                }));
            // A mark is only written when somebody was actually written to.
            // Marking a failed send would spend the reminder on nothing.
            if (sent === 0) continue;

            // The mark is merged into the manifest the producing run wrote, not
            // put in place of it: the manifest is the record of what that file
            // contained, and a cron job has no business replacing it.
            manifest[wantsFinal ? INTAKE_REMINDER_FINAL_KEY : INTAKE_REMINDER_FIRST_KEY] = now.toISOString();
            await db.update(migrationBatches)
                .set({ manifest: JSON.stringify(manifest) })
                .where(and(
                    eq(migrationBatches.id, batch.id),
                    eq(migrationBatches.tenantId, batch.tenantId),
                ));
            if (wantsFinal) finalReminded++;
            else firstReminded++;
        }

        return { scanned: candidates.length, firstReminded, finalReminded };
    }
}
