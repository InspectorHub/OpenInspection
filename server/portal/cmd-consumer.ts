import { drizzle } from 'drizzle-orm/d1';
import { eq, and, lt } from 'drizzle-orm';
import { tenants, processedCmdEvents, parkedCmdEvents } from '../lib/db/schema';
import { logger } from '../lib/logger';
import {
    parseCmdEnvelope, isKnownCmd, cmdTenantUpdateDataSchema, cmdSyncQuotaDataSchema,
    type CmdEnvelope,
} from '../lib/sync-events/cmd-envelope';
import { applySyncQuota, applyTenantUpdate } from './apply-commands';
import { applyAdminCredential } from './admin-credential';

/**
 * A-21 — consumer for `inspectorhub-cmd-saas` (portal→core commands).
 * Pipeline per message: parse → park | known? → dedup → seq guard → apply.
 * Outcomes mirror portal's applyEnvelope, plus 'stale':
 *   - 'applied'   — mutation done, applied_cmd_seq advanced.
 *   - 'duplicate' — already in processed_cmd_events.
 *   - 'stale'     — tenantseq <= tenants.applied_cmd_seq (reordered/old) → drop.
 *   - 'parked'    — parse failure or unknown type/version → parked_cmd_events + ack.
 * Transient apply error: dedup marker rolled back, error rethrown → caller
 * retries with backoff; exhaustion → cmd-DLQ → portal marks the row failed.
 */

export type CmdApplyResult = 'applied' | 'duplicate' | 'stale' | 'stale-credential-applied' | 'parked';

const PARSE_FAIL_MAX = 2000;

type Db = ReturnType<typeof drizzle>;

async function park(db: Db, id: string, envelope: string, reason: string): Promise<void> {
    await db.insert(parkedCmdEvents)
        .values({ id, envelope, reason, receivedAt: Math.floor(Date.now() / 1000) })
        .onConflictDoNothing();
}

export async function applyCmdEnvelope(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    raw: unknown,
): Promise<CmdApplyResult> {
    const db = drizzle(dbBinding);
    const env = parseCmdEnvelope(raw);

    if (!env) {
        const rawStr = typeof raw === 'string' ? raw : safeStringify(raw);
        await park(db, crypto.randomUUID(), rawStr.slice(0, PARSE_FAIL_MAX), 'parse-failed');
        logger.warn('[cmd] parked unparseable envelope');
        return 'parked';
    }
    if (!isKnownCmd(env.type, env.dataschema)) {
        await park(db, env.id, JSON.stringify(env), 'unknown-type-or-version');
        logger.warn('[cmd] parked unknown command', { id: env.id, type: env.type, dataschema: env.dataschema });
        return 'parked';
    }

    // Dedup insert-first: PK conflict = already applied (or already judged stale).
    try {
        await db.insert(processedCmdEvents).values({
            eventId: env.id,
            cmdType: env.type,
            processedAt: Math.floor(Date.now() / 1000),
        });
    } catch {
        return 'duplicate';
    }

    // Per-tenant stale guard. Tenant row absent → first contact (tenant.update
    // upserts it) → guard passes vacuously.
    //
    // Correctness of read-guard-then-apply relies on the consumer running with
    // max_concurrency: 1 (wrangler consumer config) — the lt-guarded seq advance
    // protects the counter, but concurrent applies could still interleave row
    // writes. Do not raise concurrency without revisiting this.
    const tenantId = env.data['tenantId'] as string | undefined;
    if (tenantId) {
        const row = await db.select({ applied: tenants.appliedCmdSeq })
            .from(tenants).where(eq(tenants.id, tenantId)).get();
        if (row && env.tenantseq <= row.applied) {
            // Stale tenant-field state — superseded by a newer command. But
            // credentials ride cmd.tenant.update SPARSELY (only password-change
            // commands carry them), so a stale credential-bearing command must
            // still salvage the credential or core never receives the new hash
            // (the newer, higher-seq command didn't carry one). Email-keyed
            // idempotent upsert; tenant fields stay dropped; seq not advanced.
            if (env.type === 'io.inspectorhub.cmd.tenant.update') {
                const cred = cmdTenantUpdateDataSchema.safeParse(env.data);
                if (cred.success && cred.data.adminEmail && cred.data.adminPasswordHash) {
                    await applyAdminCredential(dbBinding, {
                        tenantId: cred.data.tenantId,
                        adminEmail: cred.data.adminEmail,
                        adminPasswordHash: cred.data.adminPasswordHash,
                    });
                    logger.info('[cmd] stale command — credential salvaged', { id: env.id, tenantseq: env.tenantseq, applied: row.applied });
                    return 'stale-credential-applied';
                }
            }
            logger.info('[cmd] stale command dropped', { id: env.id, tenantseq: env.tenantseq, applied: row.applied });
            return 'stale'; // dedup marker stays — a redelivery is equally stale
        }
    }

    try {
        await applyKnownCmd(dbBinding, kv, env);
        // Advance the high-water mark (guarded so a concurrent higher write wins).
        if (tenantId) {
            await db.update(tenants)
                .set({ appliedCmdSeq: env.tenantseq })
                .where(and(eq(tenants.id, tenantId), lt(tenants.appliedCmdSeq, env.tenantseq)));
        }
        return 'applied';
    } catch (err) {
        await db.delete(processedCmdEvents).where(eq(processedCmdEvents.eventId, env.id)).catch(() => {});
        logger.error('[cmd] command apply failed', { id: env.id, type: env.type },
            err instanceof Error ? err : undefined);
        throw err;
    }
}

async function applyKnownCmd(dbBinding: D1Database, kv: KVNamespace | undefined, env: CmdEnvelope): Promise<void> {
    switch (env.type) {
        case 'io.inspectorhub.cmd.tenant.update': {
            const data = cmdTenantUpdateDataSchema.parse(env.data);
            // exactOptionalPropertyTypes: true — only spread optional fields when
            // present; passing explicit `undefined` for an optional narrow type
            // is a type error.
            await applyTenantUpdate(dbBinding, kv, {
                id: data.tenantId,
                slug: data.slug,
                status: data.status as 'pending' | 'active' | 'suspended' | 'trial',
                ...(data.tier !== undefined && { tier: data.tier as 'free' | 'pro' | 'enterprise' }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.maxUsers !== undefined && { maxUsers: data.maxUsers }),
                ...(data.adminEmail !== undefined && { adminEmail: data.adminEmail }),
                ...(data.adminPasswordHash !== undefined && { adminPasswordHash: data.adminPasswordHash }),
            });
            return;
        }
        case 'io.inspectorhub.cmd.tenant.sync_quota': {
            const data = cmdSyncQuotaDataSchema.parse(env.data);
            const result = await applySyncQuota(dbBinding, kv, data);
            if (result === 'tenant-not-found') {
                // Tenant genuinely unknown — retrying won't help, but the quota
                // may simply have raced ahead of the tenant upsert; throw so the
                // queue retry gives the upsert time to land.
                throw new Error(`sync_quota: tenant not found ${data.tenantId}`);
            }
            return;
        }
        default:
            throw new Error(`Unhandled known cmd type ${env.type as string}`);
    }
}

function safeStringify(value: unknown): string {
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

/** Mirror of portal's queue-loop backoff. */
function backoffSeconds(attempts: number): number {
    return Math.min(30 * 2 ** attempts, 3600);
}

/** Batch handler for the cmd queue. STRICTLY per-message ack/retry. */
export async function handleCmdBatch(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    batch: MessageBatch<unknown>,
): Promise<void> {
    for (const msg of batch.messages) {
        try {
            const result = await applyCmdEnvelope(dbBinding, kv, msg.body);
            logger.info('[cmd] queue message handled', { id: msg.id, attempts: msg.attempts, result });
            msg.ack();
        } catch (err) {
            const delaySeconds = backoffSeconds(msg.attempts);
            logger.error('[cmd] queue message failed — retrying',
                { id: msg.id, attempts: msg.attempts, delaySeconds },
                err instanceof Error ? err : undefined);
            msg.retry({ delaySeconds });
        }
    }
}
