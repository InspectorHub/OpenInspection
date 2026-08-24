/**
 * The reply half of the portal→core command seam.
 *
 * Split out of `cmd-consumer.ts` when that file crossed the 400-line gate. The
 * seam is really two concerns that happen to share a queue: applying a command,
 * and telling the producer what happened. This is the second one — which type
 * of reply a command earns, and how it is emitted — and it has no knowledge of
 * dedup, the stale guard, or any applier.
 */
import { logger } from '../lib/logger';
import type { CmdEnvelope } from '../lib/sync-events/cmd-envelope';
import type { CmdReplyEventType, SyncEnvelope } from '../lib/sync-events/envelope';
import { OutboxService, type OutboxRow } from './outbox.service';

/** Map a command type to its reply event type (null = command never replies —
 *  quota/seed carry no replyto today and would just be ignored).
 *
 * An ALIAS now, not a second list. It used to spell out the six reply names, and
 * the outbox service spelled them out again; keeping the two in step was left to
 * a comment, and a reply that reached only one of them compiled on the emitting
 * side while being unassignable on the other. Both now derive from the seam
 * registry, so registering a reply in `SCHEMAS` is the single act that makes it
 * nameable here.
 *
 * @declarationEmit Kept as a named export so the emitted `.d.ts` can NAME it: it
 * is `replyTypeFor`'s return type, and nothing imports it. */
export type CmdReplyType = CmdReplyEventType;

export function replyTypeFor(cmdType: string): CmdReplyType | null {
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
        // The correction reply is the ONLY thing that tells the sender which of
        // the three endings happened. Unlike the pair above, whose absence would
        // merely leave a request waiting, an absent reply here is also the
        // signal for the third ending — see `apply-report-correction.ts`.
        case 'io.inspectorhub.cmd.report.correct': return 'reply.report.corrected';
        // The operator's three answers to a waiting import run. THREE replies
        // and not one with an outcome: these are three different commands a
        // person chose between, not one request with several endings — and
        // `acknowledged` is not an ending at all, since the run stays waiting
        // and its deadline keeps running. Like the DSAR replies these wake
        // nothing: the correlation handle (`import:<batchId>`) names a durable
        // row on the other side, not a parked Workflow, so there is no
        // waitForEvent timeout behind them and no RPC fallback.
        case 'io.inspectorhub.cmd.migration.deliver': return 'reply.migration.delivered';
        case 'io.inspectorhub.cmd.migration.decline': return 'reply.migration.declined';
        case 'io.inspectorhub.cmd.migration.acknowledge': return 'reply.migration.acknowledged';
        default: return null;
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
export async function emitReply(
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
