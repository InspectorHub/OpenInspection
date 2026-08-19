import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { migrationBatches } from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS } from '../../lib/status/migration-batch-status';
import {
    MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS,
    MIGRATION_INTAKE_REMINDER_LEAD_DAYS,
    MIGRATION_INTAKE_STAGED_RETENTION_DAYS,
} from '../../lib/compliance/retention-windows';
import { NotificationService } from '../notification.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The key a sent reminder is recorded under, inside the batch's manifest JSON.
 *
 * On the manifest rather than in a column of its own: the manifest is already
 * the one JSON payload this table carries, and a boolean column would make
 * every reader of the schema ask what it is before concluding it is a mark on a
 * cron job.
 */
export const MIGRATION_INTAKE_REMINDED_METADATA_KEY = 'intakeExpiryReminderSentAt';

/**
 * When a run created now stops being kept.
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

/** The reminder's own outcome. Both halves are reported, always — see `remindExpiring`. */
export interface ExpiryReminderSummary {
    /**
     * How many unfinished runs with a clock this pass looked at, whether or not
     * any of them were due.
     */
    scanned: number;
    /** How many of those were told. */
    reminded: number;
}

/**
 * The messages an intake run sends, and the mark that keeps each to one.
 *
 * Both go through the in-app notification path the rest of the product uses;
 * nothing new is introduced to carry them.
 */
export class MigrationAssistanceService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Tells the workspace that a converted file has landed and the run is theirs
     * to review.
     *
     * They press apply, not us. What arrives is a plan they can read before
     * anything is written, which is the difference between this and inserting
     * rows into somebody's workspace on their behalf.
     */
    async notifyDelivered(tenantId: string, batchId: string): Promise<void> {
        const notifications = new NotificationService(this.db);
        await notifications.createForAllAdmins(tenantId, {
            type: 'migration_intake_ready',
            title: 'Your import is ready to review',
            body: 'We have converted the file you sent. Open it to check what will be imported, then apply it.',
            entityType: 'migration_batch',
            entityId: batchId,
        });
    }

    /**
     * One reminder per run, in the days before it stops being kept.
     *
     * Returns BOTH numbers, and `scanned` counts every unfinished run carrying a
     * clock rather than only the ones inside the lead window. That distinction
     * is the whole value of the pair: if the window filter lived in the query,
     * a pass whose date arithmetic had broken would report `scanned: 0,
     * reminded: 0` — which is exactly what a quiet, healthy day reports too.
     * Counting the population first and deciding in memory keeps "nothing was
     * due" and "nothing was examined" different sentences.
     *
     * The population is bounded by construction: only runs still being prepared
     * or still waiting on us are in it, and every one of them is deleted on its
     * own date.
     */
    async remindExpiring(now: Date): Promise<ExpiryReminderSummary> {
        const db = this.getDrizzle();
        const cutoff = now.getTime() + MIGRATION_INTAKE_REMINDER_LEAD_DAYS * DAY_MS;

        const scanned = await db.select({
            id: migrationBatches.id,
            tenantId: migrationBatches.tenantId,
            manifest: migrationBatches.manifest,
            expiresAt: migrationBatches.expiresAt,
        })
            .from(migrationBatches)
            .where(and(
                inArray(migrationBatches.status, REMINDABLE),
                isNotNull(migrationBatches.expiresAt),
            ))
            .all();

        const notifications = new NotificationService(this.db);
        let reminded = 0;

        for (const batch of scanned) {
            const due = batch.expiresAt?.getTime();
            if (due === undefined) continue;
            // Already past its date is the sweep's business. A reminder about
            // something that has gone is worse than none.
            if (due <= now.getTime()) continue;
            if (due > cutoff) continue;

            const manifest = JSON.parse(batch.manifest) as Record<string, unknown>;
            if (manifest[MIGRATION_INTAKE_REMINDED_METADATA_KEY]) continue;

            await notifications.createForAllAdmins(batch.tenantId, {
                type: 'migration_intake_expiring',
                title: 'An import you started is about to be cleared',
                body: 'The file you uploaded and the entries prepared from it will be deleted soon. '
                    + 'Finish the import, or start it again later with a fresh upload.',
                entityType: 'migration_batch',
                entityId: batch.id,
            });

            // The mark is merged into the manifest the producing run wrote, not
            // put in place of it: the manifest is the record of what that file
            // contained, and a cron job has no business replacing it.
            manifest[MIGRATION_INTAKE_REMINDED_METADATA_KEY] = now.toISOString();
            await db.update(migrationBatches)
                .set({ manifest: JSON.stringify(manifest) })
                .where(and(
                    eq(migrationBatches.id, batch.id),
                    eq(migrationBatches.tenantId, batch.tenantId),
                ));
            reminded++;
        }

        return { scanned: scanned.length, reminded };
    }
}
