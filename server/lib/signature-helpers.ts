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

/**
 * Shared e-signature helpers used by the inspections, admin and invoices route
 * modules so the report / agreement / payment email senders can append the
 * inspector's rebooking signature footer and build the correct per-recipient
 * sign/checkout link. Behavior-preserving extraction — logic unchanged.
 */

export type SenderSignature = { name: string | null; email: string | null; phone: string | null; licenseNumber: string | null; signatureEnabled: boolean | null };

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
): Promise<SignatureUser | undefined> {
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
        return { ...row, tenantSlug };
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
        return row ?? undefined;
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
