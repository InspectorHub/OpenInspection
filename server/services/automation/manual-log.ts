import type { drizzle } from 'drizzle-orm/d1';
import { automationLogs } from '../../lib/db/schema';
import { logger } from '../../lib/logger';

/**
 * Ledger writer for MANUAL sends (Communication A2.2) — rows in
 * `automation_logs` with `automation_id IS NULL` as the manual marker, so the
 * Outbox answers "what left this office" regardless of who pressed Send.
 *
 * One factory call per batch: `sendAt` is stamped once at construction, so
 * every row the batch emits shares it and the Outbox collapses the send into
 * one notice (grouping key is `(automation_id, send_at)`).
 */
export function makeManualSendLogger(
    db: ReturnType<typeof drizzle>,
    tenantId: string,
    inspectionId: string,
    channel: 'email' | 'sms' = 'email',
) {
    const batchSendAt = new Date();
    return async (row: {
        recipient: string; contactId: string | null; roleKey: string;
        status: 'sent' | 'skipped' | 'failed'; error?: string;
    }) => {
        try {
            await db.insert(automationLogs).values({
                id: crypto.randomUUID(), tenantId, automationId: null, inspectionId,
                recipient: row.recipient, recipientRoleKey: row.roleKey,
                recipientContactId: row.contactId, channel,
                sendAt: batchSendAt, status: row.status, error: row.error ?? null,
            });
        } catch (err) {
            // The ledger records the send; it must never be the reason one fails.
            logger.error('[manual-send-log] ledger write failed', { inspectionId }, err instanceof Error ? err : undefined);
        }
    };
}
