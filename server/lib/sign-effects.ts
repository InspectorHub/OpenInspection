import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users, inspections, agreementRequests } from './db/schema';
import { logger } from './logger';
import { resolveAutomationCompanyName } from '../services/automation/company-name';
import { getBookingHost } from './url';
import { envelopeVerifyUrl } from './agreement-verify-url';
import type { HonoConfig } from '../types/hono';
import { fireAndForget } from './fire-and-forget';

/**
 * Track I-a — fire-and-forget side effects that run exactly ONCE when an
 * agreement ENVELOPE completes (all required signatures collected under the
 * envelope's completion policy). Extracted verbatim from the old
 * `signAgreementRoute` handler so the per-signer rewrite drives a single
 * completion path regardless of which signer's signature closed the envelope.
 *
 * Pipeline (all awaited / scheduled exactly as before):
 *   1. envelope-level 'agreement.signed' audit append (try/catch)
 *   2. verificationToken generation + persist on the envelope row
 *   3. SIGN_COMPLETION_WORKFLOW.create (waitUntil, id = requestId)
 *   4. structured 'agreement.signed.audit' log
 *   5. admin in-app notification (waitUntil)
 *   6. envelope 'agreement.signed' automation trigger (fire-and-forget)
 *   7. confirmation email to signer + CC inspector (waitUntil)
 */
export async function runEnvelopeCompletionPipeline(
    c: Context<HonoConfig>,
    args: {
        requestId: string;
        tenantId: string;
        inspectionId: string | null;
        clientEmail: string | null;
        clientName: string | null;
        agreementId: string;
    },
): Promise<void> {
    // `agreementId` stays in the args type — it is part of the completion
    // payload every caller already has — but nothing in this function reads it
    // now that the hard-coded office alert is a rule.
    const { requestId, tenantId, inspectionId, clientEmail, clientName } = args;

    // Read request-derived metadata ONCE; reuse across every step below.
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
    const ua = (c.req.header('user-agent') || '').slice(0, 200) || null;
    const country = c.req.header('cf-ipcountry') || null;

    // (1) Spec 5H P0 — envelope-level audit append. Wrapped in try/catch so a
    // chain write failure never blocks the signed response.
    try {
        await c.var.services.auditLog.append(tenantId, requestId, 'agreement.signed', {
            country,
            envelopeId: requestId,
            ip,
            tsMs: Date.now(),
            ua,
        });
    } catch (e) {
        logger.warn('audit.append.signed.failed', { requestId, error: (e as Error).message });
    }

    // (2) Spec 5H P2 — opaque verifier token (independent of write-permission
    // tokens). Persist directly on the envelope row; the per-signer service no
    // longer mints it.
    const verificationToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    try {
        await drizzle(c.env.DB).update(agreementRequests)
            .set({ verificationToken })
            .where(eq(agreementRequests.id, requestId));
    } catch (e) {
        logger.warn('agreement.verification-token.persist.failed', { requestId, error: (e as Error).message });
    }

    // (3) Spec 5H P1 — async sign-completion workflow (renders signed.pdf +
    // Certificate of Completion + appends 'workflow.complete'). Fire-and-forget;
    // workflow id = requestId for idempotency / re-run.
    if (c.env.SIGN_COMPLETION_WORKFLOW) {
        const tenantSlug = c.get('requestedTenantSlug') ?? '';
        c.executionCtx.waitUntil((async () => {
            try {
                await c.env.SIGN_COMPLETION_WORKFLOW!.create({
                    id: requestId,
                    params: { requestId, tenantId, tenantSlug },
                });
            } catch (e) {
                logger.warn('sign-workflow.create.failed', { requestId, error: (e as Error).message });
            }
        })());
    }

    // (4) Free-tier structured log — redundancy in case the D1 audit
    // write fails after the Workers commit.
    logger.info('agreement.signed.audit', {
        event: 'agreement.signed.audit',
        requestId,
        tenantId,
        clientName: clientName ?? null,
        signedAt: new Date().toISOString(),
        signerIp: ip,
        signerUserAgent: ua,
        signerCountry: country,
    });

    // (5) B3 — the office alert is a rule now (`Office alert — agreement
    // signed`, recipientKind 'staff', channel in_app), raised by the
    // `agreement.signed` trigger step (6) below already fires. The block that
    // stood here fetched the agreement's display name only to build a
    // hard-coded title; the rule's template owns that wording instead.

    // (6) Spec 2A — envelope-level automation event so per-tenant rules can react.
    if (inspectionId) {
        fireAndForget(c, c.var.services.automation.trigger({
            tenantId,
            inspectionId,
            triggerEvent: 'agreement.signed',
            companyName: await resolveAutomationCompanyName(drizzle(c.env.DB), tenantId),
            reportBaseUrl: c.env.APP_BASE_URL || '',
        }), 'automation trigger', { event: 'agreement.signed', tenantId });
    }

    // (7) Sprint 1 C-8 — confirmation email to the signer (CC the inspector so
    // both parties keep a record). The verifier URL is the tamper-evident receipt.
    if (clientEmail) {
        c.executionCtx.waitUntil((async () => {
            try {
                const built = await buildSignedConfirmation(c, requestId, inspectionId);
                await c.var.services.email.sendAgreementSignedConfirmation(
                    clientEmail,
                    built.inspectorEmail ? [built.inspectorEmail] : [],
                    clientName || 'Client',
                    built.propertyAddress,
                    built.verifyUrl,
                    built.confirmationId,
                    new Date().toUTCString(),
                    ip,
                    built.sigInspector,
                    getBookingHost(c),
                );
            } catch (e) {
                logger.error('agreement.signed confirmation email failed', {}, e instanceof Error ? e : undefined);
            }
        })());
    }
}

/**
 * Resolves the shared bits of an agreement-signed confirmation email: the
 * tamper-evident verify URL (always the ENVELOPE verifier), a short
 * confirmation id, the property address, and the inspector to CC + sign the
 * footer with. Reused by both the envelope-completion email and the per-signer
 * in-person receipt so the two never drift.
 */
async function buildSignedConfirmation(
    c: Context<HonoConfig>,
    requestId: string,
    inspectionId: string | null,
): Promise<{
    verifyUrl: string;
    confirmationId: string;
    propertyAddress: string;
    inspectorEmail: string | null;
    sigInspector: {
        name: string | null; email: string | null; phone: string | null;
        slug: string | null;
    } | undefined;
}> {
    const baseUrl = (c.env.APP_BASE_URL || '').replace(/\/$/, '') || (() => {
        const host = c.req.header('host');
        return host ? `https://${host}` : '';
    })();
    const verifyUrl = envelopeVerifyUrl(baseUrl, requestId);
    const confirmationId = requestId.replace(/-/g, '').slice(0, 8).toUpperCase();

    let inspectorEmail: string | null = null;
    let inspectorRow: typeof users.$inferSelect | null = null;
    let propertyAddress = 'your inspection';
    if (inspectionId) {
        const db = drizzle(c.env.DB);
        const insp = await db.select().from(inspections)
            .where(eq(inspections.id, inspectionId)).get();
        if (insp?.propertyAddress) propertyAddress = insp.propertyAddress;
        if (insp?.inspectorId) {
            const insRow = await db.select().from(users)
                .where(eq(users.id, insp.inspectorId)).get();
            inspectorEmail = insRow?.email ?? null;
            inspectorRow = insRow ?? null;
        }
    }

    const sigInspector = inspectorRow ? {
        name: inspectorRow.name ?? null,
        email: inspectorRow.email ?? null,
        phone: inspectorRow.phone ?? null,
        slug: inspectorRow.slug ?? null,
    } : undefined;

    return { verifyUrl, confirmationId, propertyAddress, inspectorEmail, sigInspector };
}

/**
 * Track I-a Task 5 — per-signer receipt email for in-person (on-site) signing.
 *
 * Fires after EVERY successful in-person signature (not only on envelope
 * completion) so each signer who signs on the inspector's device walks away
 * with a tamper-evident receipt at THEIR OWN email. Fire-and-forget; the
 * verify URL is the same envelope verifier as the completion email.
 *
 * Callers MUST skip this when the envelope just completed AND the signer's
 * email equals the envelope clientEmail — the completion pipeline already
 * emailed that address, and a double email would result.
 */
export async function runSignerReceiptEffects(
    c: Context<HonoConfig>,
    args: { signerEmail: string; signerName: string; inspectionId: string | null; requestId: string },
): Promise<void> {
    const { signerEmail, signerName, inspectionId, requestId } = args;
    if (!signerEmail) return;
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
    c.executionCtx.waitUntil((async () => {
        try {
            const built = await buildSignedConfirmation(c, requestId, inspectionId);
            await c.var.services.email.sendAgreementSignedConfirmation(
                signerEmail,
                built.inspectorEmail ? [built.inspectorEmail] : [],
                signerName || 'Signer',
                built.propertyAddress,
                built.verifyUrl,
                built.confirmationId,
                new Date().toUTCString(),
                ip,
                built.sigInspector,
                getBookingHost(c),
            );
        } catch (e) {
            logger.error('agreement.signer receipt email failed', {}, e instanceof Error ? e : undefined);
        }
    })());
}
