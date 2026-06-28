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
 */
export interface EmailSuppressionPort {
    isSuppressed(email: string): Promise<boolean>;
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
    };
}
