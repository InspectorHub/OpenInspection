/**
 * May this workspace PRODUCE a courtesy translation?
 *
 * ⚠️ The one question this module answers, and the one it must never be used
 * for. Production is gated; CONSUMPTION never is. A reader path that asked this
 * before showing a translation would silently strip every translation already
 * delivered the moment a workspace changed a setting — so reader paths answer
 * from stored `report_translations` rows and nothing else, and the service that
 * reads them states that as an invariant in its own header.
 *
 * Removal is not gated by it either. Cleaning up after switching the feature
 * off is exactly when removal is needed.
 *
 * Fails CLOSED: an unreadable or absent config row answers `false`. A workspace
 * that has never opened the settings page has not opted into per-publish spend,
 * and the absence of a choice is not a choice. Since these fields moved to
 * `tenant_ai_configs`, "absent row" is the state EVERY workspace starts in
 * rather than an edge case — which makes the fail-closed default the answer
 * almost everyone gets, and the right one for exactly the same reason.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantAiConfigs } from '../db/schema';

export async function isCourtesyTranslationEnabled(
    db: D1Database,
    tenantId: string,
): Promise<boolean> {
    const row = await drizzle(db)
        .select({ enabled: tenantAiConfigs.isCourtesyTranslationEnabled })
        .from(tenantAiConfigs)
        .where(eq(tenantAiConfigs.tenantId, tenantId))
        .get();
    return row?.enabled === true;
}
