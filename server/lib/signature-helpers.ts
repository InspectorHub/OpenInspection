import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { and, eq } from 'drizzle-orm';
import { users } from './db/schema';
import { resolveTenantSlug, getBookingHost } from './url';
import { agreementSignUrl, checkoutUrl } from './public-urls';
import { shouldUseCheckoutLink } from './agreement-link';
import { logger } from './logger';
import { getDrizzle } from './route-helpers';
import type { SignatureUser } from './inspector-signature';
import { CredentialService, type RenderableCredential } from '../services/credential.service';

/**
 * Shared e-signature helpers used by the inspections, admin and invoices route
 * modules so the report / agreement / payment email senders can append the
 * inspector's rebooking signature footer and build the correct per-recipient
 * sign/checkout link. Behavior-preserving extraction — logic unchanged.
 */

export type SenderSignature = {
    name: string | null;
    email: string | null;
    phone: string | null;
    licenseNumber: string | null;
    signatureEnabled: boolean | null;
    /**
     * Spec B — the sender's active credentials. This field is why the badges
     * reached nobody: `inspectorSignature()` has rendered credentials since Spec
     * B, and the type that carries a signature to the send path had nowhere to
     * put them, so every send silently omitted what the settings page promised
     * was "shown on your reports, emails, and booking page".
     */
    credentials: RenderableCredential[];
};

/**
 * A resolved signature, with credentials REQUIRED.
 *
 * `SignatureUser.credentials` is optional — it has to be, because the renderer
 * accepts callers that predate Spec B. That optionality is exactly how the
 * badges came to reach nobody: every resolver simply never set the field and
 * nothing complained. Narrowing the resolvers' own return type turns the next
 * omission into a compile error instead of a silently emptier email.
 */
export type ResolvedSignature = SignatureUser & { credentials: RenderableCredential[] };

/**
 * The sender's renderable credentials, or none.
 *
 * Tolerant on purpose, and consistent with everything else in this module: a
 * signature footer is a courtesy appended to an email that has a job to do. A
 * failed credential lookup must cost the reader a badge, never the report link
 * the email exists to deliver.
 */
async function safeCredentials(
    c: Context<HonoConfig>,
    tenantId: string,
    userId: string,
): Promise<RenderableCredential[]> {
    try {
        return await new CredentialService(c.env.DB).listRenderable(tenantId, userId);
    } catch (err) {
        logger.warn('email.signature.credentials.failed', { userId, error: (err as Error).message });
        return [];
    }
}

/**
 * Sprint B-4a — resolves the inspector record for an inspection so outbound
 * report / agreement / share emails can append the inspector's rebooking
 * signature footer. Returns undefined when the inspection has no assigned
 * inspector or the lookup fails — callers should pass undefined through to
 * EmailService methods, which will skip the footer in that case.
 */
export async function resolveSignatureInspector(
    c: Context<HonoConfig>,
    inspectorId: string | null | undefined,
    tenantId: string,
): Promise<ResolvedSignature | undefined> {
    if (!inspectorId) return undefined;
    try {
        const db = getDrizzle(c);
        const row = await db.select({
            name:             users.name,
            email:            users.email,
            phone:            users.phone,
            licenseNumber:    users.licenseNumber,
            slug:             users.slug,
            signatureEnabled: users.signatureEnabled,
        }).from(users).where(and(eq(users.id, inspectorId), eq(users.tenantId, tenantId))).get();
        if (!row) return undefined;
        // saas-aware: requestedTenantSlug is empty in saas, so the "Book again"
        // link would otherwise drop. Resolve via the shared helper (DB fallback).
        const tenantSlug = (await resolveTenantSlug(c, tenantId)) || null;
        const credentials = await safeCredentials(c, tenantId, inspectorId);
        return { ...row, tenantSlug, credentials };
    } catch (err) {
        logger.error('[email-signature] inspector lookup failed', { inspectorId }, err instanceof Error ? err : undefined);
        return undefined;
    }
}

/**
 * Look up the current admin/inspector's signature block so the recipient can
 * rebook with them via the embedded booking link (Sprint B-4a). Tolerant —
 * any failure yields `undefined` (no signature appended).
 */
export async function lookupSenderSignature(c: Context<HonoConfig>, tenantId: string): Promise<SenderSignature | undefined> {
    const senderId = c.get('user')?.sub;
    if (!senderId) return undefined;
    try {
        const row = await getDrizzle(c).select({
            name:             users.name,
            email:            users.email,
            phone:            users.phone,
            licenseNumber:    users.licenseNumber,
            signatureEnabled: users.signatureEnabled,
        }).from(users)
            .where(and(eq(users.id, senderId), eq(users.tenantId, tenantId)))
            .get();
        if (!row) return undefined;
        return { ...row, credentials: await safeCredentials(c, tenantId, senderId) };
    } catch (err) {
        logger.warn('agreement.signature.lookup.failed', { senderId, error: (err as Error).message });
        return undefined;
    }
}

/**
 * Per-recipient link rule (shared by send + remind + copy-link): combined
 * Sign & pay checkout when the inspection requires payment AND has an
 * outstanding invoice, otherwise the standalone sign page. `token` is the
 * recipient's persistent public token (per-signer in the envelope model).
 */
export async function buildSignUrl(c: Context<HonoConfig>, tenantId: string, inspectionId: string | null | undefined, tenantSlug: string, token: string): Promise<string> {
    const host = getBookingHost(c);
    return (await shouldUseCheckoutLink(c.env.DB, tenantId, inspectionId))
        ? checkoutUrl(host, tenantSlug, token)
        : agreementSignUrl(host, tenantSlug, token);
}
