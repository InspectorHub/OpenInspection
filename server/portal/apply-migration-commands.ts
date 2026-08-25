import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { migrationBatches } from '../lib/db/schema';
import { writeAuditRow } from '../lib/audit';
import { logger } from '../lib/logger';
import { limitsFor } from '../lib/migration-intake/limits';
import { SAAS_PROFILE } from '../lib/deployment-profile';
import { MigrationStageService } from '../services/migration-intake/stage.service';
import { MigrationAssistanceService } from '../services/migration-intake/assistance.service';
import { assertStaffAccessAuthorized } from '../services/migration-intake/staff-access';
import {
    cmdMigrationAcknowledgeDataSchema,
    cmdMigrationDeclineDataSchema,
    cmdMigrationDeliverDataSchema,
    type CmdEnvelope,
} from '../lib/sync-events/cmd-envelope';
import type { EmailServiceEnv } from '../lib/email/build-email-service';

/**
 * The operator's three answers to an import run waiting on a person, applied
 * from the command queue instead of from an admin POST.
 *
 * ── What the queue buys that the POSTs cannot ───────────────────────────────
 * The three POSTs in `api/admin/admin-data-import.ts` still exist and still
 * work; they are for somebody signed into the workspace. These are for somebody
 * who is NOT, and the difference is not only authentication. Delivery writes
 * into a tenant, can be large, and can fail halfway — so it must be retryable
 * without applying twice, which is dedup (`processed_cmd_events`), a parking lot
 * for a command nobody can interpret, and a reply so the sender learns what
 * happened. All of that already exists on this seam; these three inherit it.
 *
 * ── Every write here names the PLATFORM person ──────────────────────────────
 * `user_id` stays NULL and `platform_actor_id` carries the sender's own staff
 * identifier. That is the whole point: before this, a support session was
 * indistinguishable from the customer in the audit log, because the only actor
 * a row could name was the workspace's own administrator.
 *
 * ── `assertStaffAccessAuthorized` is asked here too, not only in the route ──
 * A rule enforced in a route handler is exactly the kind that goes missing when
 * a second transport reaches the same write. A run nobody authorised a person to
 * open receives nothing through this door either, and the refusal is a THROW: on
 * this seam a throw rolls back the dedup marker and retries, and an exhausted
 * retry becomes a dead command the console shows. A silent skip would leave the
 * sender believing it landed.
 */

/** The `replyto` handle these commands use — `import:<batchId>`. */
export function migrationReplyTo(batchId: string): string {
    return `import:${batchId}`;
}

async function loadBatch(dbBinding: D1Database, tenantId: string, batchId: string) {
    const batch = await drizzle(dbBinding).select().from(migrationBatches)
        .where(and(eq(migrationBatches.id, batchId), eq(migrationBatches.tenantId, tenantId)))
        .get();
    if (!batch) throw new Error(`migration command: no such run ${batchId} in ${tenantId}`);
    return batch;
}

/**
 * The tenant's own mailer, when this deployment gave the consumer one.
 *
 * Absent in tests and on a deployment with no email configured, and the answer
 * is to log rather than throw: the thing the message is about has already
 * happened, and rolling a delivery back over an unsent notice would retry a
 * write that already landed. Email only — this pipeline never falls back to
 * another channel, because a person who gave us an email address does not get a
 * text about a file.
 */
async function notify(
    emailEnv: EmailServiceEnv | undefined,
    tenantId: string,
    what: string,
    send: (svc: MigrationAssistanceService, mailer: Awaited<ReturnType<MigrationAssistanceService['mailerFor']>>) => Promise<number>,
): Promise<void> {
    if (!emailEnv) {
        logger.warn('[cmd] migration command applied but nobody could be told', { tenantId, what });
        return;
    }
    try {
        const svc = new MigrationAssistanceService(emailEnv);
        await send(svc, await svc.mailerFor(tenantId));
    } catch (err) {
        logger.error('[cmd] migration notification not delivered', { tenantId, what },
            err instanceof Error ? err : new Error(String(err)));
    }
}

/**
 * Apply one `cmd.migration.*`. Returns the reply EXTRAS — the fields beyond the
 * {tenantId, correlationId, replyto} base that `emitReply` supplies.
 */
export async function applyMigrationCommand(
    dbBinding: D1Database,
    env: CmdEnvelope,
    emailEnv?: EmailServiceEnv,
): Promise<Record<string, unknown> | undefined> {
    switch (env.type) {
        case 'io.inspectorhub.cmd.migration.deliver': {
            const data = cmdMigrationDeliverDataSchema.parse(env.data);
            // Before anything is parsed: a run nobody authorised a person to read
            // does not receive what a person produced from reading it.
            assertStaffAccessAuthorized(await loadBatch(dbBinding, data.tenantId, data.batchId));
            const result = await new MigrationStageService(dbBinding).stageIntoBatch({
                tenantId: data.tenantId,
                batchId: data.batchId,
                bundle: data.bundle,
                // The deployment's own ceiling. A command arriving from the
                // operator's console is still bound by what this deployment will
                // stage, and reading it from the payload would let the sender
                // raise its own limit.
                limits: limitsFor(SAAS_PROFILE),
            });
            await notify(emailEnv, data.tenantId, 'ready',
                (svc, mailer) => svc.notifyDelivered(mailer, data.tenantId, data.batchId));
            await writeAuditRow({
                db: dbBinding,
                tenantId: data.tenantId,
                actorKind: 'platform_staff',
                platformActorId: data.actor.platformAdminId,
                action: 'migration.delivered',
                entityType: 'migration_batch',
                entityId: data.batchId,
                metadata: { rows: result.rows.length },
            });
            return { batchId: data.batchId, rows: result.rows.length };
        }
        case 'io.inspectorhub.cmd.migration.decline': {
            const data = cmdMigrationDeclineDataSchema.parse(env.data);
            await new MigrationStageService(dbBinding).declineBatch({
                tenantId: data.tenantId, batchId: data.batchId, reason: data.reason,
            });
            // The reason is on the run and on the REPLY, never in the audit
            // metadata: metadata is redacted on the way in, and a redacted
            // reason is not a reason.
            await writeAuditRow({
                db: dbBinding,
                tenantId: data.tenantId,
                actorKind: 'platform_staff',
                platformActorId: data.actor.platformAdminId,
                action: 'migration.declined',
                entityType: 'migration_batch',
                entityId: data.batchId,
            });
            await notify(emailEnv, data.tenantId, 'declined',
                (svc, mailer) => svc.notifyDeclined(mailer, data.tenantId, data.batchId, data.reason));
            return { batchId: data.batchId, reason: data.reason };
        }
        case 'io.inspectorhub.cmd.migration.acknowledge': {
            const data = cmdMigrationAcknowledgeDataSchema.parse(env.data);
            const batch = await loadBatch(dbBinding, data.tenantId, data.batchId);
            // The same precondition delivery applies, for the same reason:
            // acknowledging a run is the moment a person says they have picked
            // the file up.
            assertStaffAccessAuthorized(batch);
            const manifest = JSON.parse(batch.manifest) as Record<string, unknown>;
            // Merged into the manifest the producing run wrote, not put in place
            // of it. THE RUN DOES NOT MOVE: acknowledging a file is not
            // converting it, and the deadline to deliver or decline keeps
            // running — which is why the console goes on counting it.
            manifest['acknowledgedAt'] = new Date().toISOString();
            await drizzle(dbBinding).update(migrationBatches)
                .set({ manifest: JSON.stringify(manifest) })
                .where(and(eq(migrationBatches.id, data.batchId), eq(migrationBatches.tenantId, data.tenantId)));
            await writeAuditRow({
                db: dbBinding,
                tenantId: data.tenantId,
                actorKind: 'platform_staff',
                platformActorId: data.actor.platformAdminId,
                action: 'migration.acknowledged',
                entityType: 'migration_batch',
                entityId: data.batchId,
            });
            await notify(emailEnv, data.tenantId, 'received',
                (svc, mailer) => svc.notifyReceived(mailer, data.tenantId, data.batchId));
            return { batchId: data.batchId };
        }
        default:
            throw new Error(`applyMigrationCommand: not a migration command (${env.type})`);
    }
}
