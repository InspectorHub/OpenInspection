/**
 * The two once-a-day jobs.
 *
 * They used to run inside `getUTCHours() === 3` / `=== 4` guards on the
 * five-minute tick, at the END of a thirteen-job serial chain: one qualifying
 * tick per day, in the position a CPU overrun cuts off first, and neither logs
 * anything on a no-op pass - so on a free-tier deployment they effectively
 * never ran and nothing said so. Each now owns a cron expression, and therefore
 * an invocation and a CPU budget of its own.
 */
import { tenants } from '../../lib/db/schema/tenant/core';
import type { DailyRetentionEnv } from '../../lib/cron/daily-retention-tasks';
import { logger } from '../../lib/logger';
import { DAILY_03, DAILY_04, db, exists, type CronJob } from '../types';

// 6b. OI #276 — log-table retention (RETENTION_MANIFEST), plus the intake
//     expiry reminder that rides the same schedule. Separate from the block
//     above because that one is the per-tenant AGREEMENT clock keyed on a
//     purged_at marker; these are fixed platform windows. One job cannot
//     hold two definitions of "due".
//     Always-on in both modes — storage limitation is not a topology
//     question. Idempotent, and each half wraps its own failure.
export const retentionLogsJob: CronJob = {
    key: 'retention-logs',
    label: 'Expire log tables on their fixed platform windows',
    trigger: DAILY_04,
    modes: ['standalone', 'saas'],
    maxBatch: 1,
    // No hour check here any more: the trigger IS the schedule. The old
    // guard (`getUTCHours() === 4 && getUTCMinutes() < 5`) meant exactly one
    // tick a day qualified, and it sat near the end of a thirteen-job serial
    // chain — so on a free-tier deployment, where the chain was cut short
    // every time, this job effectively never ran, and it logs nothing on a
    // no-op pass so nothing reported that. Its own trigger gives it its own
    // invocation with its own CPU budget.
    probe: async () => 1,
    run: async (env) => {
        const { runDailyRetentionTasks } = await import('../../lib/cron/daily-retention-tasks');
        // `ScheduledEnv` declares the mail bindings optional because most
        // cron jobs do not send, while this one does — its expiry reminder
        // goes out as email built for the tenant. On a deployment genuinely
        // missing `TENANT_CACHE` the mailer throws, is caught by the
        // consumer and logged, which is the loud failure we want rather
        // than a sweep that quietly stops chasing.
        await runDailyRetentionTasks(env as DailyRetentionEnv, new Date());
        return { processed: 1, nextCursor: null };
    },
};

// 7. Daily R2 usage measurement. Writes an r2_bytes gauge per tenant via
//    MeteringService. Runs in every mode — standalone simply has one tenant
//    in the table, so it records a single whole-instance measurement,
//    populating the /settings/usage Storage figure everywhere.
export const r2UsageJob: CronJob = {
    key: 'r2-usage',
    label: 'Measure per-tenant R2 usage',
    trigger: DAILY_03,
    modes: ['standalone', 'saas'],
    maxBatch: 1,
    // Same reasoning as retention-logs: the trigger is the schedule, so the
    // old `getUTCHours() === 3` guard is gone rather than double-gating.
    // What remains is the job's real precondition — a bucket to measure.
    probe: async (env) => {
        if (!env.PHOTOS) return 0;
        return exists(db(env).select({ id: tenants.id }).from(tenants).limit(1).get());
    },
    run: async (env) => {
        const { MeteringService } = await import('../../services/metering.service');
        const { R2UsageService } = await import('../../services/r2-usage.service');
        const ids = (await db(env).select({ id: tenants.id }).from(tenants).all()).map((r) => r.id);
        await new R2UsageService(env.PHOTOS!, new MeteringService(env.DB)).measureAll(ids);
        logger.info('[usage] R2 measurement complete', { tenants: ids.length });
        return { processed: ids.length, nextCursor: null };
    },
};
