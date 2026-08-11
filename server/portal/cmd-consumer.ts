import { drizzle } from 'drizzle-orm/d1';
import { eq, and, lt } from 'drizzle-orm';
import { tenants, processedCmdEvents, parkedCmdEvents } from '../lib/db/schema';
import { logger } from '../lib/logger';
import {
    parseCmdEnvelope, isKnownCmd, cmdTenantUpdateDataSchema, cmdSyncQuotaDataSchema,
    cmdSeedStarterContentDataSchema, cmdDataExportDataSchema, cmdPurgeDataSchema,
    cmdTenantAiCapsDataSchema, cmdSubjectExportDataSchema, cmdSubjectEraseDataSchema,
    type CmdEnvelope,
} from '../lib/sync-events/cmd-envelope';
import type { SyncEnvelope } from '../lib/sync-events/envelope';
import { applySyncQuota, applyTenantUpdate, applySeedStarterContent, applyAiCaps } from './apply-commands';
import { applyCredentialIfFresh } from './admin-credential';
import { parkedFingerprint } from './parked-fingerprint';
import { OutboxService, type OutboxRow } from './outbox.service';

/** A-21 batch 3 — R2 bindings the offboarding commands need. Optional: absent
 *  in standalone (no portal direction at all) and in tests that don't
 *  exercise export/purge. */
export interface CmdConsumerBuckets {
    photos?: R2Bucket | undefined;
    exports?: R2Bucket | undefined;
}

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

type Db = ReturnType<typeof drizzle>;

/** `envelope` holds a FINGERPRINT, never the message — see parked-fingerprint.ts
 *  for why, and for what a reader of this row can still answer. */
async function park(db: Db, id: string, envelope: string, reason: string): Promise<void> {
    await db.insert(parkedCmdEvents)
        .values({ id, envelope, reason, receivedAt: new Date() })
        .onConflictDoNothing();
}

export async function applyCmdEnvelope(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    raw: unknown,
    syncQueue?: Queue<SyncEnvelope>,
    buckets?: CmdConsumerBuckets,
): Promise<CmdApplyResult> {
    const db = drizzle(dbBinding);
    const env = parseCmdEnvelope(raw);

    if (!env) {
        await park(db, crypto.randomUUID(), await parkedFingerprint(raw, null), 'parse-failed');
        logger.warn('[cmd] parked unparseable envelope');
        return 'parked';
    }
    if (!isKnownCmd(env.type, env.dataschema)) {
        await park(db, env.id, await parkedFingerprint(raw, env), 'unknown-type-or-version');
        logger.warn('[cmd] parked unknown command', { id: env.id, type: env.type, dataschema: env.dataschema });
        return 'parked';
    }

    // Dedup insert-first: PK conflict = already applied (or already judged stale).
    try {
        await db.insert(processedCmdEvents).values({
            eventId: env.id,
            cmdType: env.type,
            processedAt: new Date(),
        });
    } catch {
        // A-21 batch 2: a duplicate still re-emits the reply (tenant.update
        // only — export/purge reply payloads aren't reconstructable here; their
        // lost-reply recovery is the workflow timeout → RPC fallback). The
        // producer's retry loop re-sends the SAME envelope id when the original
        // reply was lost — without this, a lost reply could never recover.
        if (replyTypeFor(env.type) === 'reply.tenant.updated') {
            await emitReply(dbBinding, syncQueue, env, { result: 'duplicate' });
        }
        return 'duplicate';
    }

    // Per-tenant stale guard. Tenant row absent → first contact (tenant.update
    // upserts it) → guard passes vacuously.
    //
    // ⚠️ EXEMPT: the Privacy P3 subject commands. The guard answers "has this
    // TENANT-FIELD STATE been superseded?" — last-writer-wins over slug/status/
    // tier/quota, where dropping an older write is exactly right. A DSAR is not
    // state; it is an OPERATION on behalf of a natural person, carrying a
    // statutory deadline, and it shares `tenants.cmd_seq` with every unrelated
    // tenant command only because portal has one sequence per tenant. Left
    // guarded, a quota sync that merely OVERTOOK the erasure in the queue would
    // drop it — silently, with no reply, leaving portal's request at
    // `fulfilling` until the Art. 12(3) month ran out. Nothing about the erasure
    // is superseded by a seat-count change.
    //
    // Safe to exempt because both subject commands are idempotent and
    // order-independent: the export overwrites its own r2Key, and a re-run
    // erasure finds its predicates already cleared and matches zero rows. They
    // also never advance the high-water mark (the advance below is `lt`-guarded,
    // so a lower seq is a no-op) — an exempted command cannot make a genuinely
    // stale tenant update look fresh.
    //
    // Correctness of read-guard-then-apply relies on the consumer running with
    // max_concurrency: 1 (wrangler consumer config) — the lt-guarded seq advance
    // protects the counter, but concurrent applies could still interleave row
    // writes. Do not raise concurrency without revisiting this.
    const tenantId = env.data['tenantId'] as string | undefined;
    if (tenantId && !isSubjectCmd(env.type)) {
        const row = await db.select({ applied: tenants.appliedCmdSeq })
            .from(tenants).where(eq(tenants.id, tenantId)).get();
        if (row && env.tenantseq <= row.applied) {
            // Stale tenant-field state — superseded by a newer command. But
            // credentials ride cmd.tenant.update SPARSELY (only password-change
            // commands carry them), so a stale credential-bearing command must
            // still salvage the credential or core never receives the new hash
            // (the newer, higher-seq command didn't carry one). Email-keyed
            // idempotent upsert; tenant fields stay dropped; seq not advanced.
            // Batch 2: the salvage itself is guarded by the CREDENTIAL stream
            // (`credseq` vs applied_cred_seq) so a stale credential can no
            // longer overwrite a newer one.
            if (env.type === 'io.inspectorhub.cmd.tenant.update') {
                const cred = cmdTenantUpdateDataSchema.safeParse(env.data);
                if (cred.success && cred.data.adminEmail && cred.data.adminPasswordHash) {
                    const credResult = await applyCredentialIfFresh(dbBinding, {
                        tenantId: cred.data.tenantId,
                        adminEmail: cred.data.adminEmail,
                        adminPasswordHash: cred.data.adminPasswordHash,
                        ...(env.credseq !== undefined && { credseq: env.credseq }),
                    });
                    if (credResult === 'credential-applied') {
                        logger.info('[cmd] stale command — credential salvaged', { id: env.id, tenantseq: env.tenantseq, applied: row.applied });
                        await emitReply(dbBinding, syncQueue, env, { result: 'stale-credential-applied' });
                        return 'stale-credential-applied';
                    }
                }
            }
            logger.info('[cmd] stale command dropped', { id: env.id, tenantseq: env.tenantseq, applied: row.applied });
            if (replyTypeFor(env.type) === 'reply.tenant.updated') {
                await emitReply(dbBinding, syncQueue, env, { result: 'stale' });
            }
            return 'stale'; // dedup marker stays — a redelivery is equally stale
        }
    }

    try {
        const replyExtra = await applyKnownCmd(dbBinding, kv, env, buckets);
        // Advance the high-water mark (guarded so a concurrent higher write wins).
        if (tenantId) {
            await db.update(tenants)
                .set({ appliedCmdSeq: env.tenantseq })
                .where(and(eq(tenants.id, tenantId), lt(tenants.appliedCmdSeq, env.tenantseq)));
        }
        const replyType = replyTypeFor(env.type);
        await emitReply(dbBinding, syncQueue, env,
            replyType === 'reply.tenant.updated'
                ? { result: 'applied', ...(replyExtra ?? {}) }
                : (replyExtra ?? {}));
        return 'applied';
    } catch (err) {
        await db.delete(processedCmdEvents).where(eq(processedCmdEvents.eventId, env.id)).catch(() => {});
        logger.error('[cmd] command apply failed', { id: env.id, type: env.type },
            err instanceof Error ? err : undefined);
        throw err;
    }
}

/** Map a command type to its reply event type (null = command never replies —
 *  quota/seed carry no replyto today and would just be ignored). */
type CmdReplyType = 'reply.tenant.updated' | 'reply.tenant.export_completed' | 'reply.tenant.purged'
    | 'reply.subject.exported' | 'reply.subject.erased';
/** The DSAR pair — operations on behalf of a person, not tenant state. Used by
 *  the stale-guard exemption above; see the reasoning there. */
function isSubjectCmd(cmdType: string): boolean {
    return cmdType === 'io.inspectorhub.cmd.subject.export'
        || cmdType === 'io.inspectorhub.cmd.subject.erase';
}

function replyTypeFor(cmdType: string): CmdReplyType | null {
    switch (cmdType) {
        case 'io.inspectorhub.cmd.tenant.update': return 'reply.tenant.updated';
        case 'io.inspectorhub.cmd.tenant.data_export': return 'reply.tenant.export_completed';
        case 'io.inspectorhub.cmd.tenant.purge': return 'reply.tenant.purged';
        // Privacy P3 — the DSAR replies. Unlike the tenant replies these wake
        // NOTHING: a DSAR is a durable portal row, not a parked Workflow, so
        // there is no waitForEvent timeout behind them and no RPC fallback. The
        // durability that stands in for it is the sync outbox (append first,
        // publish inline, cron sweeper republishes stragglers).
        case 'io.inspectorhub.cmd.subject.export': return 'reply.subject.exported';
        case 'io.inspectorhub.cmd.subject.erase': return 'reply.subject.erased';
        default: return null;
    }
}

/** Apply a known command. Returns the reply-payload EXTRAS for commands whose
 *  replies carry data beyond the verdict (export → r2Key+manifest, purge →
 *  destruction counts); undefined otherwise. */
async function applyKnownCmd(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    env: CmdEnvelope,
    buckets?: CmdConsumerBuckets,
): Promise<Record<string, unknown> | undefined> {
    switch (env.type) {
        case 'io.inspectorhub.cmd.tenant.update': {
            const data = cmdTenantUpdateDataSchema.parse(env.data);
            // exactOptionalPropertyTypes: true — only spread optional fields when
            // present; passing explicit `undefined` for an optional narrow type
            // is a type error.
            //
            // Batch 2: credentials are STRIPPED from the provider call and applied
            // separately under the credential-stream guard. (The PATCH RPC endpoint
            // keeps the provider's inline credential path — no credseq there.)
            await applyTenantUpdate(dbBinding, kv, {
                id: data.tenantId,
                slug: data.slug,
                status: data.status as 'pending' | 'active' | 'suspended' | 'trial',
                ...(data.tier !== undefined && { tier: data.tier as 'free' | 'pro' | 'enterprise' }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.maxUsers !== undefined && { maxUsers: data.maxUsers }),
            });
            if (data.adminEmail && data.adminPasswordHash) {
                await applyCredentialIfFresh(dbBinding, {
                    tenantId: data.tenantId,
                    adminEmail: data.adminEmail,
                    adminPasswordHash: data.adminPasswordHash,
                    ...(env.credseq !== undefined && { credseq: env.credseq }),
                });
            }
            return;
        }
        case 'io.inspectorhub.cmd.tenant.seed_starter_content': {
            const data = cmdSeedStarterContentDataSchema.parse(env.data);
            const result = await applySeedStarterContent(dbBinding, data);
            if (result === 'tenant-not-found') {
                // Seed raced ahead of the tenant upsert — throw so the queue
                // retry gives the upsert time to land (mirrors sync_quota).
                throw new Error(`seed_starter_content: tenant not found ${data.tenantId}`);
            }
            return undefined;
        }
        case 'io.inspectorhub.cmd.tenant.data_export': {
            // A-21 batch 3 — stream the tenant ZIP straight into the shared
            // exports bucket; the reply carries r2Key + manifest. A missing
            // binding throws (retryable → DLQ if genuinely misconfigured —
            // surfaced on the portal console as a failed cmd row).
            const data = cmdDataExportDataSchema.parse(env.data);
            if (!buckets?.photos || !buckets?.exports) {
                throw new Error('data_export: PHOTOS/EXPORTS_BUCKET not bound');
            }
            const { DataExportService } = await import('../services/data-export.service');
            const svc = new DataExportService(dbBinding, buckets.photos);
            const manifest = await svc.buildZipToR2(data.tenantId, buckets.exports, data.r2Key);
            return { r2Key: data.r2Key, manifest };
        }
        case 'io.inspectorhub.cmd.tenant.purge': {
            // A-21 batch 3 — purge + reply with destruction counts (A-20).
            // Core also writes the durable tenant_destruction_records row.
            const data = cmdPurgeDataSchema.parse(env.data);
            if (!buckets?.photos) throw new Error('purge: PHOTOS not bound');
            if (!kv) throw new Error('purge: TENANT_CACHE not bound');
            const { TenantPurgeService } = await import('../services/tenant-purge.service');
            const result = await new TenantPurgeService(dbBinding, buckets.photos, kv).purge(data.tenantId);
            return { ...result };
        }
        case 'io.inspectorhub.cmd.tenant.ai_caps': {
            const data = cmdTenantAiCapsDataSchema.parse(env.data);
            const result = await applyAiCaps(dbBinding, kv, data);
            if (result === 'tenant-not-found') {
                // Same reasoning as sync_quota: the caps fan-out may have raced
                // ahead of the tenant upsert, so throw and let the retry give it
                // time to land rather than writing a config row for a tenant
                // that does not exist.
                throw new Error(`ai_caps: tenant not found ${data.tenantId}`);
            }
            return;
        }
        case 'io.inspectorhub.cmd.subject.export': {
            // Privacy P3 — Art. 15 access request for a NON-account data
            // subject. Strict parse: these are the only commands whose payload
            // names a natural person, so an unexpected field means the sender
            // believes core does something it does not (see cmd-envelope.ts).
            const data = cmdSubjectExportDataSchema.parse(env.data);
            const { applySubjectExport } = await import('./apply-subject-commands');
            return applySubjectExport(drizzle(dbBinding), buckets ?? {}, data);
        }
        case 'io.inspectorhub.cmd.subject.erase': {
            // Privacy P3 — Art. 17 erasure. The reply MUST carry the coverage
            // disclosure; the applier refuses to produce one for a partial run
            // rather than let portal record an unbacked "completed".
            const data = cmdSubjectEraseDataSchema.parse(env.data);
            const { applySubjectErase } = await import('./apply-subject-commands');
            return applySubjectErase(drizzle(dbBinding), data,
                env.replyto !== undefined ? { requestedBy: env.replyto } : {});
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

/**
 * A-21 batch 2/3 — emit the command's reply event when it asked for one
 * (`replyto` present). The reply type is derived from the command type
 * (update → reply.tenant.updated, data_export → reply.tenant.export_completed,
 * purge → reply.tenant.purged); `fields` carries the type-specific payload
 * beyond the {tenantId, correlationId, replyto} base. The reply rides the
 * EXISTING core→portal sync queue via the sync outbox (durable: append first,
 * inline publish best-effort, the cron sweeper republishes stragglers).
 * Emission failure must NEVER fail the command — the command already applied;
 * a missing reply self-heals via the producer's timeout path.
 */
async function emitReply(
    dbBinding: D1Database,
    syncQueue: Queue<SyncEnvelope> | undefined,
    env: CmdEnvelope,
    fields: Record<string, unknown>,
): Promise<void> {
    if (!env.replyto) return;
    const replyType = replyTypeFor(env.type);
    if (!replyType) return;
    try {
        let insertedRow: OutboxRow | undefined;
        const outbox = new OutboxService(dbBinding, (row) => { insertedRow = row; });
        await outbox.append({
            type: replyType,
            payload: {
                tenantId: (env.data['tenantId'] as string | undefined) ?? '',
                correlationId: env.id,
                replyto: env.replyto,
                ...fields,
            },
        });
        if (syncQueue && insertedRow) {
            // Inline publish; a throw is caught below and the row stays
            // `pending` for the sweeper.
            await outbox.publishRow(syncQueue, insertedRow);
        }
        logger.info('[cmd] reply emitted', { correlationId: env.id, replyType, published: !!(syncQueue && insertedRow) });
    } catch (err) {
        logger.error('[cmd] reply emission failed — outbox sweeper will retry if appended',
            { id: env.id, replyType }, err instanceof Error ? err : undefined);
    }
}

/** Mirror of portal's queue-loop backoff. */
function backoffSeconds(attempts: number): number {
    return Math.min(30 * 2 ** attempts, 3600);
}

/** Batch handler for the cmd queue. STRICTLY per-message ack/retry.
 *  `syncQueue` (A-21 batch 2) carries replies back to portal; `buckets`
 *  (batch 3) carries the R2 bindings the offboarding commands need — both
 *  optional so the standalone build type-checks unchanged. */
export async function handleCmdBatch(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    batch: MessageBatch<unknown>,
    syncQueue?: Queue<SyncEnvelope>,
    buckets?: CmdConsumerBuckets,
): Promise<void> {
    for (const msg of batch.messages) {
        try {
            const result = await applyCmdEnvelope(dbBinding, kv, msg.body, syncQueue, buckets);
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
