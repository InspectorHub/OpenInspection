/**
 * The executors whose tables have NO tenant dimension.
 *
 * The split from `retention-executors.ts` is on exactly the line the
 * legal-hold invariant draws. A hold is placed on a tenant; an executor
 * over a table with a `tenant_id` column can exclude that tenant's rows, and one
 * over a table without it cannot express the hold at all. Keeping the second
 * group in its own file makes that property structural instead of something a
 * reader has to reconstruct from eighteen WHERE clauses — and makes adding a new
 * tenant-less sweep a decision somebody has to make in the right file.
 *
 * Each rule here carries its answer in the manifest's `legalHold` field:
 *
 *   `suspend_all`    — `sync_outbox`, `parked_cmd_events`. Both hold a command
 *                      or account payload with the tenant identity INSIDE a JSON
 *                      blob, so there is nothing to filter on. The driver skips
 *                      them entirely while any hold is in force.
 *   `not_applicable` — the two dedup ledgers, which hold an event id and a
 *                      timestamp and nothing else; and `sms_disclosure_versions`,
 *                      which is protected by reference rather than by hold (see
 *                      its executor).
 *
 * Nothing here takes `ctx.heldTenantIds`, and that absence is the point.
 */
import { and, eq, exists, lt, ne, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
    parkedCmdEvents,
    processedCmdEvents,
    processedWebhookEvents,
    syncOutbox,
    smsConsentLog,
    smsDisclosureVersions,
} from '../db/schema';
import { SYNC_OUTBOX_STATUS } from '../status/sync-outbox-status';
import { changeCount } from './db-row-utils';
import type { Executor } from './retention-executor-context';

export const PLATFORM_EXECUTORS: Record<string, Executor> = {
    processed_webhook_events: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(processedWebhookEvents)
            .where(lt(processedWebhookEvents.receivedAt, cutoff))
            .run();
        return changeCount(res);
    },

    // `processed_at`, NOT `received_at`. The two dedup ledgers were written
    // months apart and never converged on a column name; a rule pointed at the
    // wrong one matches nothing and reads exactly like a rule that works.
    processed_cmd_events: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(processedCmdEvents)
            .where(lt(processedCmdEvents.processedAt, cutoff))
            .run();
        return changeCount(res);
    },

    parked_cmd_events: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(parkedCmdEvents)
            .where(lt(parkedCmdEvents.receivedAt, cutoff))
            .run();
        return changeCount(res);
    },

    // TERMINAL rows only. `ne(status, 'pending')` rather than an IN-list of the
    // terminal values on purpose: it also catches the LEGACY `done` rows that
    // `SYNC_OUTBOX_STATUSES` deliberately omits (nothing may write it, but rows
    // holding it exist), which an allow-list would silently leave behind
    // forever. Excluding `pending` is the rule, not an optimization — a pending
    // row is unpublished work the cron sweeper is still retrying, so deleting
    // one destroys an account change portal never saw instead of retiring a
    // record of one.
    sync_outbox: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(syncOutbox)
            .where(and(
                lt(syncOutbox.createdAt, cutoff),
                ne(syncOutbox.status, SYNC_OUTBOX_STATUS.PENDING),
            ))
            .run();
        return changeCount(res);
    },

    // Two guards, and both are load-bearing. `sms_consent_log` is kept
    // INDEFINITELY by an explicit exemption — the record is the tenant's
    // defence against a consent challenge — and every consent row stamps the
    // disclosure version it was shown. Deleting a cited version would leave
    // permanent evidence pointing at text that no longer exists, which guts the
    // exemption from the other side. The current (highest) version is also kept:
    // it is what the next opt-in will show.
    //
    // This is also why the rule is `not_applicable` for legal hold rather than
    // suspended: the referencing table is never swept under any circumstance, so
    // a version cited by a held tenant's consent row is already unreachable by
    // this statement. The dependency is a stronger guarantee than the hold, and
    // it does not lapse when the hold is released.
    sms_disclosure_versions: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(smsDisclosureVersions)
            .where(and(
                lt(smsDisclosureVersions.publishedAt, cutoff),
                notExists(
                    db.select({ one: sql`1` }).from(smsConsentLog)
                        .where(eq(smsConsentLog.disclosureVersion, smsDisclosureVersions.version)),
                ),
                exists(
                    db.select({ one: sql`1` }).from(alias(smsDisclosureVersions, 'sdv_newer'))
                        .where(sql`sdv_newer.version > ${smsDisclosureVersions.version}`),
                ),
            ))
            .run();
        return changeCount(res);
    },
};
