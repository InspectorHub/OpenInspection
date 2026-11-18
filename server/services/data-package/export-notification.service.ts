/**
 * §9B.1 — export-start confirmation email.
 *
 * Sent to the owner account that authorized the export. The message carries
 * only the tenant, start time, non-PII device label and how to cancel — never
 * package PII, row data or the excluded-file list. Delivery is best effort: a
 * provider failure must never fail a job that was otherwise authorized and
 * started, so callers fire this off with `executionCtx.waitUntil` and swallow
 * errors here as well.
 */
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { tenants, users } from '../../lib/db/schema';
import { buildTenantEmailService, type EmailServiceEnv } from '../../lib/email/build-email-service';
import { escapeHtml } from '../email/html-helpers';
import { logger } from '../../lib/logger';
import type { DrizzleDB } from '../../lib/db/scoped';
import type { HonoConfig } from '../../types/hono';

export interface ExportStartNotification {
    tenantId: string;
    userId: string;
    deviceLabel: string;
    jobId: string;
    startedAt: number;
}

/**
 * Hand the send to the platform's waitUntil when available (so a slow provider
 * never keeps the start request open), and swallow everything otherwise. A
 * mail failure must never fail a job that is otherwise authorized and started.
 */
export function notifyExportStartBestEffort(
    c: Context<HonoConfig>,
    db: DrizzleDB,
    info: ExportStartNotification,
): void {
    const notice = notifyExportStart(c.env as EmailServiceEnv, db, info);
    try { c.executionCtx.waitUntil(notice); } catch { void notice; }
}

/** Resolve the owner's email and the tenant slug in one tenant-scoped read. */
async function ownerContact(db: DrizzleDB, tenantId: string, userId: string) {
    const rows = await db.select({ email: users.email, slug: tenants.slug })
        .from(users)
        .innerJoin(tenants, eq(users.tenantId, tenants.id))
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
        .limit(1);
    return rows[0];
}

/**
 * Send the confirmation. Returns true only when a provider actually accepted
 * the message. Never throws — a missing tenant row, unconfigured mail provider
 * or provider outage are all logged and reported as a non-delivery.
 */
export async function notifyExportStart(
    env: EmailServiceEnv,
    db: DrizzleDB,
    info: ExportStartNotification,
): Promise<boolean> {
    try {
        const owner = await ownerContact(db, info.tenantId, info.userId);
        if (!owner?.email) {
            logger.warn('[data-package] export-start email skipped: owner has no email', { jobId: info.jobId });
            return false;
        }
        const tenantLabel = owner.slug || info.tenantId;
        const startedAtIso = new Date(info.startedAt).toISOString();
        const subject = `Data export started for ${tenantLabel}`;
        // Intentionally a flat, dependency-free body: no per-row data, no
        // counts, no excluded-file detail — only what lets the owner recognise
        // and stop an export they did not expect.
        const html = [
            '<p>A data export was started for your workspace.</p>',
            '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse">',
            `<tr><td><strong>Workspace</strong></td><td>${escapeHtml(tenantLabel)}</td></tr>`,
            `<tr><td><strong>Started at</strong></td><td>${escapeHtml(startedAtIso)}</td></tr>`,
            `<tr><td><strong>Device</strong></td><td>${escapeHtml(info.deviceLabel)}</td></tr>`,
            '</table>',
            '<p>If you did not expect this, cancel the job from <strong>Settings &rarr; Data</strong> ',
            'in the desktop app, or from the job status page in the web console.</p>',
        ].join('');
        // Naming the class is mandatory at the send boundary. `data-export-start`
        // is `required` in the notification vocabulary, so no recipient
        // preference — and no operator template switch — can suppress an
        // account-security notice of this kind.
        const email = await buildTenantEmailService(env, info.tenantId);
        const { delivered } = await email.sendEmail([owner.email], subject, html, undefined, {
            classId: 'data-export-start',
        });
        return delivered;
    } catch (err) {
        logger.warn('[data-package] export-start email failed', { jobId: info.jobId, error: String(err) });
        return false;
    }
}
