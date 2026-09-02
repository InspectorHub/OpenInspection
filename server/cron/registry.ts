/**
 * The cron job registry — the single declaration of what this Worker runs on a
 * schedule, in order.
 *
 * Before this file the thirteen jobs were thirteen inline blocks in one
 * `scheduled()` function, which had two consequences worth naming because they
 * are what this shape exists to prevent:
 *
 *   1. They shared ONE invocation, and therefore one CPU budget. The Workers
 *      Free ceiling is 10 ms PER INVOCATION, so no amount of making each job
 *      faster could fit thirteen of them into one call.
 *   2. They ran in a fixed serial order, so a budget overrun always killed the
 *      SAME jobs — the ones at the end — and killed them silently, because
 *      every success log was gated on a non-zero counter.
 *
 * Each job now declares a cheap `probe()` (is there work?) and a bounded
 * `run(cursor)` (do at most `maxBatch` units). The dispatcher probes; the queue
 * consumer runs, one job per invocation. `trigger` says which cron expression
 * owns the job, `modes` says which deployment topologies have it at all.
 *
 * Configuration gating — "is this job usable on THIS deployment right now",
 * e.g. an SMS runtime that needs a KV binding and a secret — belongs inside
 * `probe()`, returning 0. `modes` answers a different question: whether the
 * deployment SHAPE has the job. Mixing the two is how a standalone operator
 * ends up probing for portal traffic that cannot exist.
 *
 * The bodies live in `jobs/`, grouped by what they talk to. This file is the
 * ORDER and nothing else, so that "which jobs exist" stays a question with one
 * short answer — and so a job written but never listed here is visible as an
 * absence rather than hidden in a long file. `lint:cron-budget` checks for
 * exactly that.
 */
import { agreementExpiryJob, retentionAgreementsJob } from './jobs/agreements';
import { contentSeedSweepJob } from './jobs/content';
import { automationFlushJob, reminderEnqueueJob } from './jobs/automation';
import { r2UsageJob, retentionLogsJob } from './jobs/daily';
import { reportGenerationJob } from './jobs/inspections';
import {
    calendarSyncJob, managedComplianceJob, portalOutboxJob, qboCdcJob,
} from './jobs/integrations';
import { orphanMediaJob, pendingAttachmentsJob } from './jobs/media';
import { statutoryRevisionWatchJob } from './jobs/statutory';
import type { CronJob } from './types';

export { TICK, DAILY_03, DAILY_04 } from './types';
export type { CronJob } from './types';

/**
 * The order is the order the monolithic handler ran them in — blocks 1, 2, 3a,
 * 3, 4, 5, 5a-bis, 5b, 5c, 5d, 6, 6b, 7. It no longer decides who gets starved
 * by a CPU overrun, since each job now has its own invocation, but it is kept
 * so the two lists can still be compared to one another.
 */
export const CRON_JOBS: CronJob[] = [
    agreementExpiryJob,
    qboCdcJob,
    reminderEnqueueJob,
    automationFlushJob,
    portalOutboxJob,
    pendingAttachmentsJob,
    reportGenerationJob,
    orphanMediaJob,
    managedComplianceJob,
    calendarSyncJob,
    retentionAgreementsJob,
    retentionLogsJob,
    r2UsageJob,
    // Added after the thirteen. Last because it is the only job that talks to a
    // server nobody here operates, and because its probe is an array length: on
    // a deployment that publishes no statutory form it never reaches an
    // invocation at all.
    statutoryRevisionWatchJob,
    // Added after the statutory watch. Last because it is the only job whose
    // work is a CONSEQUENCE of deploying rather than of time passing: on a
    // fleet already stamped with this release it probes one LIMIT-1 select and
    // stops, and it has something to do only in the ticks after an upgrade that
    // moved STARTER_CONTENT_VERSION.
    contentSeedSweepJob,
];
