import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { emailSuppressions } from '../db/schema';

/**
 * WH-3 — the send-path suppression port. `EmailService` calls `isSuppressed`
 * before each provider send and drops any recipient that has hard-bounced or
 * filed a complaint for this tenant (see `email_suppressions`). The receiver
 * stores emails NORMALIZED (`.trim().toLowerCase()`); the caller normalizes the
 * recipient the same way before the lookup, so this helper queries the value
 * as-given.
 *
 * `recordSuppression` is the proactive write-back path: when the provider
 * rejects a send with a suppression error (the address is already on Resend's
 * list) we write it locally so the send-path gate skips it on the next attempt
 * without hitting the provider again. This complements the webhook path (which
 * writes on a hard-bounce event) — the two are idempotent thanks to the
 * INSERT OR IGNORE semantics below.
 */
export interface EmailSuppressionPort {
    isSuppressed(email: string): Promise<boolean>;
    /** Write an address into the local suppression table. FAIL-OPEN: never throws. */
    recordSuppression(email: string, reason: 'provider_rejected'): Promise<void>;
}

/**
 * Build the tenant-scoped suppression port. A thin
 * `SELECT 1 FROM email_suppressions WHERE tenant_id = ? AND email = ? LIMIT 1`.
 * Returns boolean. The send-path gate is FAIL-OPEN, so this never needs to swallow
 * its own errors — a thrown query is caught at the call site and treated as
 * "not suppressed" (a deliverability guard must not block a legitimate send).
 */
export function buildEmailSuppression(db: D1Database, tenantId: string): EmailSuppressionPort {
    return {
        async isSuppressed(email: string): Promise<boolean> {
            const row = await drizzle(db)
                .select({ id: emailSuppressions.id })
                .from(emailSuppressions)
                .where(and(
                    eq(emailSuppressions.tenantId, tenantId),
                    eq(emailSuppressions.email, email),
                ))
                .get();
            return !!row;
        },
        async recordSuppression(email: string, _reason: 'provider_rejected'): Promise<void> {
            try {
                await drizzle(db)
                    .insert(emailSuppressions)
                    .values({
                        id: crypto.randomUUID(),
                        tenantId,
                        email: email.trim().toLowerCase(),
                        reason: 'hard_bounce',   // closest semantic match: provider's suppression list is populated by hard bounces
                        sourceProvider: 'resend', // write-back only ever comes from the active provider
                        providerEventId: null,    // no event id — this is a send-path detection, not a webhook
                        createdAt: new Date(),
                    })
                    .onConflictDoNothing();
            } catch {
                // FAIL-OPEN: a write failure must never surface to the caller.
                // The webhook will catch it on the next bounce event.
            }
        },
    };
}
