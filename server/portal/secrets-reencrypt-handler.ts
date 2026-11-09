import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, isNotNull } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { tenantConfigs } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { errorSummary } from '../lib/error-summary';
import { secretsCacheKey } from '../lib/secrets-cache';
import { reencryptAllTenantSecrets, type ReencryptReport } from '../lib/secrets-reencrypt';
import { SigningKeyService } from '../services/signing-key.service';

/**
 * POST /api/platform/secrets/reencrypt — JWT_SECRET rotation: the tenants' stored secrets AND their e-sign signing keys. SaaS-only (the
 * seam is unmounted in standalone). Idempotent; the rotation procedure belongs to the operator of the hosted deployment.
 *
 * Both parts are bounded for a Free-plan invocation (50 subrequests), so the operator runs it again until it says it is finished:
 *   - `signingKeys` is done first, so it cannot be starved: at most 25 keys written per call, `remaining` = active keys still not under
 *     the current secret, `done` when that is 0. JWT_SECRET_PREVIOUS may be removed only then.
 *   - the secrets part (`reencryptAllTenantSecrets`) is NOT bounded: one select, then per tenant that needs converting one write and one
 *     cache delete. A row past the budget lands in `failed` (each row is caught on its own) and converged rows cost nothing on the next
 *     run. If the part throws as a whole, `secretsComplete` is false and `secretsError` says why; the signing-key counts are still returned.
 */
export async function secretsReencryptHandler(c: Context<HonoConfig>): Promise<Response> {
    try {
        const signingKeys = await SigningKeyService.fromEnv(c.env.DB, c.env).rewrapAll();
        const db = drizzle(c.env.DB);
        let report: ReencryptReport | null = null;
        let secretsError: string | null = null;
        try {
            report = await reencryptAllTenantSecrets({
                listRows: async () => {
                    const rows = await db
                        .select({ tenantId: tenantConfigs.tenantId, blob: tenantConfigs.secretsEnc, dekEnc: tenantConfigs.dekEnc })
                        .from(tenantConfigs)
                        .where(isNotNull(tenantConfigs.secretsEnc))
                        .all();
                    return rows.map(r => ({ tenantId: r.tenantId, blob: r.blob as string, dekEnc: r.dekEnc ?? null }));
                },
                updateRow: async (tenantId, patch) => {
                    await db.update(tenantConfigs)
                        .set({
                            ...(patch.blob !== undefined ? { secretsEnc: patch.blob } : {}),
                            ...(patch.dekEnc !== undefined ? { dekEnc: patch.dekEnc } : {}),
                            updatedAt: new Date(),
                        })
                        .where(eq(tenantConfigs.tenantId, tenantId));
                },
                bustCache: async (tenantId) => {
                    await c.env.TENANT_CACHE?.delete(secretsCacheKey(tenantId)).catch(() => {});
                },
            }, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS);
        } catch (error: unknown) {
            secretsError = errorSummary(error);
            logger.error('secrets reencrypt: the tenant secrets part did not finish', { error: secretsError });
        }
        logger.info('secrets reencrypt completed', {
            migrated: report?.migrated ?? null, rewrapped: report?.rewrapped ?? null, alreadyCurrent: report?.alreadyCurrent ?? null,
            failed: report?.failed.length ?? null, secretsComplete: report !== null,
            signingKeysRewrapped: signingKeys.rewrapped, signingKeysRemaining: signingKeys.remaining,
        });
        return c.json({ success: true, data: { ...(report ?? {}), signingKeys, secretsComplete: report !== null, ...(secretsError ? { secretsError } : {}) } });
    } catch (error: unknown) {
        logger.error('secrets reencrypt failed', { error: errorSummary(error) });
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
}
