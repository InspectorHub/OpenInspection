import type { BrowserRun } from './types/hono';
import type { SyncEnvelope } from './lib/sync-events/envelope';
import { dispatchCron } from './cron/dispatch';
import type { CronMessage } from './cron/consumer';

export interface ScheduledEnv {
    DB: D1Database;
    APP_MODE?: string;
    PHOTOS?: R2Bucket;
    RESEND_API_KEY?: string;
    SENDER_EMAIL?: string;
    APP_NAME?: string;
    APP_BASE_URL?: string;
    JWT_SECRET?: string;
    JWT_SECRET_PREVIOUS?: string;
    QBO_CLIENT_ID?: string;
    QBO_CLIENT_SECRET?: string;
    QBO_ENV?: string;
    QBO_WEBHOOK_SECRET?: string;
    // Track L — platform-default Twilio creds + the KV used by loadTwilioForTenant
    // to read per-tenant secrets. The cron SMS runtime is built only when both
    // TENANT_CACHE and JWT_SECRET are present (else SMS logs self-skip 'not configured').
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_FROM_NUMBER?: string;
    // Managed-pool ISV credentials (same as in AppEnv). Required for the managed
    // compliance cron sweep (Task 7). Absent in standalone → sweep skips silently.
    TWILIO_API_KEY_SID?: string;
    TWILIO_API_KEY_SECRET?: string;
    /** Managed-ISV Telnyx API key (Plan 2) — drives the Telnyx managed compliance
     *  sweep. Absent in standalone / Twilio-only deploys → Telnyx rows skip. */
    TELNYX_API_KEY?: string;
    /** Shared Messaging Service SID for managed_shared tenants (Task 8 send gate). */
    TWILIO_SHARED_MESSAGING_SERVICE_SID?: string;
    TENANT_CACHE?: KVNamespace;
    /** Platform Google OAuth client, for the calendar sync sweep. Tenants with
     *  their OWN client are resolved from encrypted tenant secrets instead. */
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    // Core -> portal user-sync transport (A-13/A-14). Producer binding to the
    // sync queue; the outbox sweeper republishes pending rows through it.
    // Optional — sweeper is a no-op when missing (standalone).
    SYNC_QUEUE?: Queue<SyncEnvelope>;
    /** The cron work queue. The tick enqueues one message per due job; each
     *  message is consumed as its own Worker invocation with its own CPU
     *  budget. Absent → nothing runs, which the dispatcher logs as an error
     *  rather than as silence. */
    CRON_QUEUE?: Queue<CronMessage>;
    // Spec 2 Task 2b — report.published PDF-email delivery deps (ReportPdfService
    // + InspectionService.getReportContentHash). Absent → the cron flush() falls
    // back to the generic template path (see reportDelivery construction below).
    BROWSER?: BrowserRun;
    KEY_ENCRYPTION_SECRET?: string;
}

/**
 * The cron entry point.
 *
 * What used to live here — thirteen inline job bodies, run serially on one
 * invocation — now lives in `cron/registry.ts`, one declaration per job, and
 * this function only dispatches. It runs no job body: each due job is enqueued
 * onto CRON_QUEUE and consumed as its own Worker invocation with its own CPU
 * budget, because the Workers Free ceiling is 10 ms PER INVOCATION and thirteen
 * jobs never fit in one however fast each of them is.
 *
 * A consequence worth naming: every job now sits behind the consumer's uniform
 * try/catch. One of them (the calendar sweep) had none — its comment argued the
 * sweep never throws, which is true of the sweep and not of the dynamic import
 * above it, and an import failure there took every LATER job down with it
 * without naming a cause.
 */
export async function scheduled(
    event: ScheduledEvent,
    env: ScheduledEnv,
    _ctx: ExecutionContext,
): Promise<void> {
    await dispatchCron(event, env);
}
