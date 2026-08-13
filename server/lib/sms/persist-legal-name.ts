import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { tenantConfigs } from '../db/schema';
import { logger } from '../logger';

/**
 * Carry a legal name submitted through the SMS compliance wizard back into
 * `tenant_configs.legal_name`, so a tenant who corrects it during carrier
 * registration does not have to correct it again in Settings.
 *
 * Two refusals, both deliberate:
 *  - BLANK never overwrites a stored value. The wizard's own required-check
 *    already refuses an empty submission; this is the second line so a future
 *    caller cannot erase the entity name by passing ''.
 *  - UNCHANGED writes nothing, so the settings row is not touched on every
 *    provisioning retry.
 *
 * Never throws: carrier registration must not fail because a convenience
 * write-back did.
 */
export async function persistWizardLegalName(
    db: D1Database,
    tenantId: string,
    submitted: string | null | undefined,
): Promise<void> {
    const value = submitted?.trim();
    if (!value) return;
    try {
        const drz = drizzle(db);
        const row = await drz.select({ legalName: tenantConfigs.legalName })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        if (!row || row.legalName?.trim() === value) return;
        await drz.update(tenantConfigs)
            .set({ legalName: value, updatedAt: new Date() })
            .where(eq(tenantConfigs.tenantId, tenantId));
    } catch (err) {
        // logger.warn takes (message, data) only — the third Error arg belongs to
        // logger.error. This is a non-fatal write-back, so the level stays warn
        // and the cause is folded into the data bag.
        logger.warn('sms wizard legal-name write-back failed', {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
