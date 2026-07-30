import type { drizzle } from 'drizzle-orm/d1';
import { automationLogs } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { insertNoticeHeader } from './notice-headers';

/**
 * Ledger writer for MANUAL sends (Communication A2.2) — rows in
 * `automation_logs` with `automation_id IS NULL` as the manual marker, so the
 * Outbox answers "what left this office" regardless of who pressed Send.
 *
 * One factory call per batch: `sendAt` is stamped once at construction, so
 * every row the batch emits shares it and the Outbox collapses the send into
 * one notice (grouping key is `(automation_id, send_at)`).
 *
 * C1 (design §3.13) — the batch also writes one notice HEADER per contact and
 * stamps `notice_id` on that contact's rows. A recipient with no contact id
 * gets no header (notice_id NULL; the Outbox grouping falls back to the
 * interim key). The title is a hardcoded-English literal for now — the same
 * IA-115 debt as `titleFor`; Track B moves both onto message_templates.
 */
export function makeManualSendLogger(
    db: ReturnType<typeof drizzle>,
    tenantId: string,
    inspectionId: string,
    channel: 'email' | 'sms' = 'email',
    noticeTitle = 'Inspection update',
) {
    const batchSendAt = new Date();
    const headerByContact = new Map<string, string>();
    return async (row: {
        recipient: string; contactId: string | null; roleKey: string;
        status: 'sent' | 'skipped' | 'failed'; error?: string;
    }) => {
        try {
            let noticeId: string | null = null;
            if (row.contactId) {
                noticeId = headerByContact.get(row.contactId) ?? null;
                if (!noticeId) {
                    noticeId = await insertNoticeHeader(db, {
                        tenantId, contactId: row.contactId, userId: null,
                        type: 'manual.send', title: noticeTitle,
                        inspectionId, entityType: 'inspection', entityId: inspectionId,
                    });
                    headerByContact.set(row.contactId, noticeId);
                }
            }
            await db.insert(automationLogs).values({
                id: crypto.randomUUID(), tenantId, automationId: null, inspectionId,
                recipient: row.recipient, recipientRoleKey: row.roleKey,
                recipientContactId: row.contactId, channel,
                sendAt: batchSendAt, status: row.status, error: row.error ?? null,
                noticeId,
            });
        } catch (err) {
            // The ledger records the send; it must never be the reason one fails.
            logger.error('[manual-send-log] ledger write failed', { inspectionId }, err instanceof Error ? err : undefined);
        }
    };
}
