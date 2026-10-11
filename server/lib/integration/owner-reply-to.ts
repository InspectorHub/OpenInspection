import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { tenantConfigs } from '../db/schema';
import { logger } from '../logger';

/**
 * Initialise `tenant_configs.reply_to` from the owner's email, once, when the
 * owner account is created.
 *
 * Without a configured Reply-To a customer's reply to an outbound message goes
 * to the platform sender address instead of the inspector. The owner's email is
 * the sensible default; the operator can change it later in Settings.
 *
 * Initialize-only: a value that is already set (anything but NULL / empty /
 * whitespace) is never touched. Callers invoke this only on the branch that
 * CREATES the owner, so rotating a credential later cannot refill a field the
 * operator cleared on purpose.
 *
 * Best-effort: the owner account already exists by the time this runs, and
 * failing the whole provisioning command (which retries on the branch that no
 * longer creates anything) would be worse than a blank field. The one-off
 * `scripts/backfill-reply-to.mjs` covers any tenant this misses.
 */
export async function initReplyToFromOwner(
    db: DrizzleD1Database,
    tenantId: string,
    ownerEmail: string,
): Promise<void> {
    const email = ownerEmail.trim();
    if (!email) return;
    try {
        const cfg = await db.select({ replyTo: tenantConfigs.replyTo })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        const now = new Date();
        if (!cfg) {
            await db.insert(tenantConfigs).values({ tenantId, replyTo: email, updatedAt: now });
        } else if (!cfg.replyTo || cfg.replyTo.trim() === '') {
            await db.update(tenantConfigs)
                .set({ replyTo: email, updatedAt: now })
                .where(eq(tenantConfigs.tenantId, tenantId));
        }
    } catch (err) {
        logger.warn('reply-to.init.failed', {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
