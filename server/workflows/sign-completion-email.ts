import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types/hono';
import * as schema from '../lib/db/schema';
import { envelopeVerifyUrl } from '../lib/agreement-verify-url';
import { buildTenantEmailService } from '../lib/email/build-email-service';
import { getDeploymentProfile } from '../lib/deployment-profile';
import { PlanQuotaGuard, readTenantTier } from '../features/plan-quota/guard';
import { tenantAiCapsLoader } from '../features/plan-quota/ai-caps';

export interface SignedEvidenceEmailInput {
    requestId: string;
    signedPdfR2Key: string;
    evidenceZipR2Key: string;
    /** Public origin the verify link is built on. */
    baseUrl: string;
}

/**
 * The sign-completion workflow's last step: email the client the signed PDF
 * and the evidence pack. Split out of the workflow so it can be exercised
 * without the Workflows runtime.
 *
 * Returns what it did. Throws on a send failure; the workflow step catches.
 */
export async function sendSignedEvidenceEmail(env: AppEnv, input: SignedEvidenceEmailInput): Promise<'sent' | 'skipped'> {
    const { requestId } = input;
    if (!env.PHOTOS) return 'skipped';
    const db = drizzle(env.DB, { schema });
    const req = await db.select().from(schema.agreementRequests)
        .where(eq(schema.agreementRequests.id, requestId)).get();
    if (!req) return 'skipped';
    // B-13: resolve the tenant's sender identity + branded renderer
    // (own/platform provider, display name, reply-to, template overrides)
    // even though Workflows run outside diMiddleware.
    // Free-tier pre-flight (2026-07): Workflows have no Hono context, so
    // build the guard from the pure deployment profile + a one-shot tier
    // lookup (mirrors PlanQuotaGuard.consumeInspection's own pattern).
    const profile = getDeploymentProfile(env);
    const quotaGuard = profile.hasUsageQuota
        ? new PlanQuotaGuard(env.DB, { enforced: true, billingPortalUrl: profile.billingPortalUrl, aiCaps: tenantAiCapsLoader(env.DB) })
        : undefined;
    const tenantTier = quotaGuard ? await readTenantTier(env.DB, req.tenantId) : undefined;
    const email = await buildTenantEmailService(env, req.tenantId, quotaGuard, tenantTier);
    // Readiness is the RESOLVED service's, not the deployment's: its key is the
    // tenant's own provider credential when that is configured and complete,
    // the platform key otherwise. Empty only when neither exists — then there
    // is nobody to send through, so skip before reading the artifacts.
    if (!email.apiKey) return 'skipped';
    const [signedObj, evidenceObj] = await Promise.all([
        env.PHOTOS.get(input.signedPdfR2Key),
        env.PHOTOS.get(input.evidenceZipR2Key),
    ]);
    if (!signedObj || !evidenceObj) return 'skipped';
    const signedBytes = new Uint8Array(await new Response(signedObj.body).arrayBuffer());
    const evidenceBytes = new Uint8Array(await new Response(evidenceObj.body).arrayBuffer());
    const verifyUrl = req.verificationToken
        ? `${input.baseUrl}/v/${req.verificationToken}`
        : envelopeVerifyUrl(input.baseUrl, requestId);
    await email.sendEvidencePack({
        to: req.clientEmail,
        clientName: req.clientName ?? 'Customer',
        envelopeId: requestId,
        verifyUrl,
        signedPdfBytes: signedBytes,
        evidenceZipBytes: evidenceBytes,
    });
    return 'sent';
}
