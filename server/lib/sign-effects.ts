import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users, inspections, agreementRequests } from './db/schema';
import { logger } from './logger';
import { getBookingHost } from './url';
import type { HonoConfig } from '../types/hono';

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
        presentedToken: string;
    },
): Promise<void> {
    const { requestId, tenantId, inspectionId, clientEmail, clientName, agreementId, presentedToken } = args;
    const svc = c.var.services.agreement;

    // (1) Spec 5H P0 — envelope-level audit append. Wrapped in try/catch so a
    // chain write failure never blocks the signed response.
    try {
        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
        const ua = (c.req.header('user-agent') || '').slice(0, 200) || null;
        const country = c.req.header('cf-ipcountry') || null;
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
                    params: { requestId, tenantId, tenantSlug, token: presentedToken },
                });
            } catch (e) {
                logger.warn('sign-workflow.create.failed', { requestId, error: (e as Error).message });
            }
        })());
    }

    // (4) Round 14 free-tier structured log — redundancy in case the D1 audit
    // write fails after the Workers commit.
    logger.info('agreement.signed.audit', {
        event: 'agreement.signed.audit',
        requestId,
        tenantId,
        clientName: clientName ?? null,
        signedAt: new Date().toISOString(),
        signerIp: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
        signerUserAgent: (c.req.header('user-agent') || '').slice(0, 200) || null,
        signerCountry: c.req.header('cf-ipcountry') || null,
    });

    // (5) B3 — in-app notification for all admins (fetch agreement name for a
    // richer title).
    c.executionCtx.waitUntil((async () => {
        try {
            const agreement = await svc.getAgreementByToken(presentedToken);
            await c.var.services.notification.createForAllAdmins(tenantId, {
                type: 'agreement.signed',
                title: `Agreement signed — ${agreement.agreement.name}`,
                body: clientName ? `By ${clientName}` : null,
                entityType: 'agreement',
                entityId: requestId,
                metadata: {
                    agreementId,
                    inspectionId: inspectionId ?? null,
                    clientEmail,
                },
            });
        } catch (e) {
            logger.error('agreement.signed notification failed', {}, e instanceof Error ? e : undefined);
        }
    })());

    // (6) Spec 2A — envelope-level automation event so per-tenant rules can react.
    if (inspectionId) {
        c.var.services.automation.trigger({
            tenantId,
            inspectionId,
            triggerEvent: 'agreement.signed',
            companyName: c.env.APP_NAME || 'OpenInspection',
            reportBaseUrl: c.env.APP_BASE_URL || '',
        }).catch(() => {});
    }

    // (7) Sprint 1 C-8 — confirmation email to the signer (CC the inspector so
    // both parties keep a record). The verifier URL is the tamper-evident receipt.
    if (clientEmail) {
        c.executionCtx.waitUntil((async () => {
            try {
                const baseUrl = (c.env.APP_BASE_URL || '').replace(/\/$/, '') || (() => {
                    const host = c.req.header('host');
                    return host ? `https://${host}` : '';
                })();
                const verifyUrl = baseUrl ? `${baseUrl}/verify/${requestId}` : `/verify/${requestId}`;
                const confirmationId = requestId.replace(/-/g, '').slice(0, 8).toUpperCase();
                const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;

                // Look up inspector to CC them + append the Sprint B-4c signature footer.
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
                    licenseNumber: inspectorRow.licenseNumber ?? null,
                    slug: inspectorRow.slug ?? null,
                } : undefined;

                await c.var.services.email.sendAgreementSignedConfirmation(
                    clientEmail,
                    inspectorEmail ? [inspectorEmail] : [],
                    clientName || 'Client',
                    propertyAddress,
                    verifyUrl,
                    confirmationId,
                    new Date().toUTCString(),
                    ip,
                    sigInspector,
                    getBookingHost(c),
                );
            } catch (e) {
                logger.error('agreement.signed confirmation email failed', {}, e instanceof Error ? e : undefined);
            }
        })());
    }
}
