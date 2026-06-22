// Public token-gated agreement sub-router.
// Behavior-preserving extraction from bookings.ts — route definitions and
// handler bodies are byte-identical to the original (only their location
// changed). Covers GET /agreements/:token, GET /checkout/:token,
// POST /agreements/:token/sign, POST /agreements/:token/decline.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc } from 'drizzle-orm';
import { agreements, tenantConfigs, invoices, inspections } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { withMcpMetadata } from "../../lib/route-metadata-standards";
import { runEnvelopeCompletionPipeline } from '../../lib/sign-effects';

// Local aliases for the literal unions the DB columns are narrowed to in the
// JSON responses below. Kept file-local (not exported) so the public router
// type surface is unchanged; they only de-duplicate the inline casts.
type EnvelopeStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired';
type SignerRole = 'client' | 'co_client' | 'agent' | 'other';

/**
 * GET /api/public/agreements/:token — fetch agreement content + mark viewed
 */
const getAgreementByTokenRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreements/:token',
    tags: ["bookings", "public"],
    summary: 'Get agreement for signing (public, token-gated)',
    request: { params: z.object({ token: z.string().min(1).describe('TODO describe token field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({
                            status: z.enum(['pending', 'sent', 'viewed', 'signed', 'declined', 'expired']).describe('Envelope aggregate status'),
                            clientName: z.string().nullable().describe('TODO describe clientName field for the OpenInspection MCP integration'),
                            agreementName: z.string().describe('TODO describe agreementName field for the OpenInspection MCP integration'),
                            agreementContent: z.string().describe('Pinned content snapshot served to the signer (never the live template)'),
                            // Track I-a — per-signer context for the public sign page.
                            signer: z.object({
                                name: z.string(),
                                role: z.enum(['client', 'co_client', 'agent', 'other']),
                                status: z.enum(['pending', 'sent', 'viewed', 'signed', 'declined', 'expired']),
                            }).describe('The signer resolved from the presented token'),
                            progress: z.object({
                                signed: z.number().int(),
                                total: z.number().int(),
                            }).describe('Signature progress across the envelope'),
                            completionPolicy: z.enum(['all', 'one']).describe('Envelope completion policy'),
                        }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Agreement content',
        },
    },
    operationId: "listBookingAgreements",
    description: "Auto-generated placeholder for listBookingAgreements (GET /agreements/:token, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * GET /api/public/checkout/:token — combined "Sign & pay" page data (Track I-a
 * Task 7). Resolves a SIGNER token (same tier-2 token the public sign page
 * uses) to the snapshot + envelope progress + the inspection's outstanding
 * invoice / payment state + tenant branding, so the page renders in one round
 * trip. No-auth surface: tokens are NEVER echoed back; only the minimum signer
 * context the signer themselves needs is exposed.
 */
const getCheckoutByTokenRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/checkout/:token',
    tags: ["bookings", "public"],
    summary: 'Get combined sign & pay checkout context (public, token-gated)',
    request: { params: z.object({ token: z.string().min(1).describe('Signer public token from the checkout link') }).describe('Checkout token param') },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('Whether the request succeeded'),
                        data: z.object({
                            signer: z.object({
                                name: z.string(),
                                role: z.enum(['client', 'co_client', 'agent', 'other']),
                                status: z.enum(['pending', 'sent', 'viewed', 'signed', 'declined', 'expired']),
                            }).describe('The signer resolved from the presented token'),
                            agreement: z.object({
                                name: z.string().describe('Agreement display name'),
                                content: z.string().describe('Pinned content snapshot served to the signer'),
                                contentHash: z.string().nullable().describe('SHA-256 hex of the snapshot'),
                            }).describe('Pinned agreement snapshot'),
                            envelope: z.object({
                                status: z.enum(['pending', 'sent', 'viewed', 'signed', 'declined', 'expired']).describe('Envelope aggregate status'),
                                completionPolicy: z.enum(['all', 'one']).describe('Envelope completion policy'),
                                progress: z.object({
                                    signed: z.number().int(),
                                    total: z.number().int(),
                                }).describe('Signature progress across the envelope'),
                            }).describe('Envelope status + progress'),
                            invoice: z.object({
                                id: z.string(),
                                amountCents: z.number().int(),
                                status: z.enum(['paid', 'partial', 'unpaid']),
                            }).nullable().describe('Latest invoice for the inspection, or null'),
                            payment: z.object({
                                required: z.boolean(),
                                paid: z.boolean(),
                            }).describe('Inspection payment gate state'),
                            inspection: z.object({
                                id: z.string(),
                                propertyAddress: z.string().nullable(),
                            }).describe('Minimal inspection context'),
                            branding: z.object({
                                companyName: z.string(),
                                primaryColor: z.string().nullable(),
                            }).describe('Tenant branding for the page chrome'),
                        }).describe('Combined checkout context'),
                    }),
                },
            },
            description: 'Combined checkout context',
        },
    },
    operationId: "getBookingCheckout",
    description: "Combined sign & pay context for the public checkout page (GET /checkout/:token, bookings domain). Resolves a signer token to the agreement snapshot, envelope progress, outstanding invoice/payment state, and tenant branding."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * POST /api/public/agreements/:token/sign — submit client signature
 */
const signAgreementRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/agreements/:token/sign',
    tags: ["bookings", "public"],
    summary: 'Submit client signature (public, token-gated)',
    request: {
        params: z.object({ token: z.string().min(1).describe('TODO describe token field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        signatureBase64: z.string().min(1).describe('TODO describe signatureBase64 field for the OpenInspection MCP integration'),
                        onBehalfOf: z.string().max(200).optional().describe('Client name an authorized agent is signing on behalf of'),
                        onBehalfDisclaimer: z.string().max(2000).optional().describe('Authorized-agent disclaimer text shown at sign time'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Signed',
        },
    },
    operationId: "createBookingAgreementsSign",
    description: "Auto-generated placeholder for createBookingAgreementsSign (POST /agreements/:token/sign, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/public/agreements/:token/decline — client declines the agreement
 */
const declineAgreementRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/agreements/:token/decline',
    tags: ["bookings", "public"],
    summary: 'Decline agreement (public, token-gated)',
    request: {
        params: z.object({ token: z.string().min(1).describe('TODO describe token field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: z.object({ reason: z.string().max(500).optional().describe('TODO describe reason field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Declined',
        },
    },
    operationId: "declineBooking",
    description: "Auto-generated placeholder for declineBooking (POST /agreements/:token/decline, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const agreementRoutes = createApiRouter()
    .openapi(getAgreementByTokenRoute, async (c) => {
        const { token } = c.req.valid('param');
        const svc = c.var.services.agreement;

        // Track I-a — resolve the presented token to a SIGNER (signer token first,
        // legacy envelope-token fallback w/ lazy upgrade). 404 on miss.
        const resolved = await svc.getSignerByPresentedToken(token);
        if (!resolved) throw Errors.NotFound('Signing request not found');
        const { signer, envelope } = resolved;

        // Mark this signer viewed (idempotent; rolls the envelope aggregate forward).
        await svc.markViewedBySigner(token);

        // Serve the pinned content SNAPSHOT — never the live template.
        const snapshot = await svc.getSnapshotForRequest(envelope);

        // Agreement name comes from the template row (display only, not content).
        const agreementRow = await drizzle(c.env.DB).select({ name: agreements.name })
            .from(agreements).where(eq(agreements.id, envelope.agreementId)).get();

        // Signature progress across the whole envelope.
        const signers = await svc.listSigners(envelope.tenantId, envelope.id);
        const signedCount = signers.filter((s) => s.status === 'signed').length;

        return c.json({
            success: true as const,
            data: {
                status: envelope.status as EnvelopeStatus,
                clientName: envelope.clientName ?? null,
                agreementName: agreementRow?.name ?? 'Agreement',
                agreementContent: snapshot.content,
                signer: {
                    name: signer.name,
                    role: signer.role as SignerRole,
                    // Re-read this signer's status post-view (markViewedBySigner may
                    // have flipped it from sent → viewed).
                    status: (signers.find((s) => s.id === signer.id)?.status ?? signer.status) as EnvelopeStatus,
                },
                progress: { signed: signedCount, total: signers.length },
                completionPolicy: envelope.completionPolicy as 'all' | 'one',
            },
        }, 200);
    })
    .openapi(getCheckoutByTokenRoute, async (c) => {
        const { token } = c.req.valid('param');
        const svc = c.var.services.agreement;

        // Track I-a Task 7 — resolve the presented SIGNER token to its envelope.
        // 404 on miss (same posture as the agreement public routes).
        const resolved = await svc.getSignerByPresentedToken(token);
        if (!resolved) throw Errors.NotFound('Checkout not found');
        const { signer, envelope } = resolved;

        // Checkout is always inspection-bound (sign + pay); an envelope without
        // an inspection has no payment context to combine, so treat as not found.
        if (!envelope.inspectionId) throw Errors.NotFound('Checkout not found');

        // Mark this signer viewed (idempotent; rolls the envelope aggregate
        // forward) — same as the standalone sign page, since opening checkout
        // IS viewing the agreement.
        await svc.markViewedBySigner(token);

        const db = drizzle(c.env.DB);

        // Pinned snapshot — never the live template.
        const snapshot = await svc.getSnapshotForRequest(envelope);

        // Agreement display name (display only, not content).
        const agreementRow = await db.select({ name: agreements.name })
            .from(agreements).where(eq(agreements.id, envelope.agreementId)).get();

        // Envelope progress across all signers.
        const signers = await svc.listSigners(envelope.tenantId, envelope.id);
        const signedCount = signers.filter((s) => s.status === 'signed').length;

        // Inspection + latest invoice + branding — mirrors getReportGate's
        // tenant-scoped access pattern. All reads scope on the envelope tenant.
        const tenantId = envelope.tenantId;
        const inspectionId = envelope.inspectionId;

        const inspectionRow = await db.select({
            id: inspections.id,
            propertyAddress: inspections.propertyAddress,
            paymentRequired: inspections.paymentRequired,
            paymentStatus: inspections.paymentStatus,
        }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        // Tenant-scoped read came back empty (deleted or cross-tenant) → not found.
        if (!inspectionRow) throw Errors.NotFound('Checkout not found');

        const invoiceRow = await db.select({
            id: invoices.id,
            amountCents: invoices.amountCents,
            paidAt: invoices.paidAt,
            partialPaidAt: invoices.partialPaidAt,
        }).from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.inspectionId, inspectionId)))
            .orderBy(desc(invoices.createdAt))
            .limit(1)
            .get();

        const branding = await db.select({ companyName: tenantConfigs.companyName, primaryColor: tenantConfigs.primaryColor })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        const invoiceStatus = invoiceRow
            ? (invoiceRow.paidAt ? 'paid' : invoiceRow.partialPaidAt ? 'partial' : 'unpaid')
            : null;

        return c.json({
            success: true as const,
            data: {
                signer: {
                    name: signer.name,
                    role: signer.role as SignerRole,
                    status: (signers.find((s) => s.id === signer.id)?.status ?? signer.status) as EnvelopeStatus,
                },
                agreement: {
                    name: agreementRow?.name ?? 'Agreement',
                    content: snapshot.content,
                    contentHash: snapshot.hash,
                },
                envelope: {
                    status: envelope.status as EnvelopeStatus,
                    completionPolicy: envelope.completionPolicy as 'all' | 'one',
                    progress: { signed: signedCount, total: signers.length },
                },
                invoice: invoiceRow && invoiceStatus
                    ? { id: invoiceRow.id, amountCents: invoiceRow.amountCents, status: invoiceStatus }
                    : null,
                payment: {
                    required: inspectionRow.paymentRequired === true,
                    paid: inspectionRow.paymentStatus === 'paid',
                },
                inspection: {
                    id: inspectionRow.id,
                    propertyAddress: inspectionRow.propertyAddress ?? null,
                },
                branding: {
                    companyName: branding?.companyName ?? 'OpenInspection',
                    primaryColor: branding?.primaryColor ?? null,
                },
            },
        }, 200);
    })
    .openapi(signAgreementRoute, async (c) => {
        const { token } = c.req.valid('param');
        const { signatureBase64, onBehalfOf, onBehalfDisclaimer } = c.req.valid('json');
        const svc = c.var.services.agreement;

        // Track I-a — resolve the presented token to a SIGNER. 404 on miss.
        const resolved = await svc.getSignerByPresentedToken(token);
        if (!resolved) throw Errors.NotFound('Agreement request not found');
        const { signer, envelope } = resolved;

        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
        const ua = (c.req.header('user-agent') || '').slice(0, 200) || null;
        const country = c.req.header('cf-ipcountry') || null;
        const tsMs = Date.now();

        // Spec 5H P0 — append the per-signer audit BEFORE flipping DB status so
        // chain integrity survives a partial failure (audit-before-mutation).
        // Hash the signature image for cert reference (full image stored in DB).
        const sigBytes = (() => {
            try {
                const b64 = signatureBase64.replace(/^data:image\/[a-z]+;base64,/, '');
                const bin = atob(b64);
                const out = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                return out;
            } catch { return new Uint8Array(); }
        })();
        const sigHash = sigBytes.length > 0
            ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sigBytes)))
                .map((b) => b.toString(16).padStart(2, '0')).join('')
            : null;
        try {
            await c.var.services.auditLog.append(envelope.tenantId, envelope.id, 'signer.signed', {
                envelopeId: envelope.id,
                signerId: signer.id,
                signerEmail: signer.email,
                signerRole: signer.role,
                channel: 'remote',
                contentHash: envelope.contentHash ?? null,
                onBehalfOf: onBehalfOf ?? null,
                country,
                ip,
                signatureImageHash: sigHash ? `sha256:${sigHash}` : null,
                tsMs,
                ua,
            });
        } catch (e) {
            logger.warn('audit.append.signer-signed.failed', { requestId: envelope.id, signerId: signer.id, error: (e as Error).message });
        }

        const result = await svc.markSignedBySigner(token, signatureBase64, {
            signedAtMs: tsMs,
            channel: 'remote',
            ipAddress: ip,
            userAgent: ua,
            onBehalfOf: onBehalfOf ?? null,
            onBehalfDisclaimer: onBehalfDisclaimer ?? null,
        });

        // Spec 2A — per-signer automation event so per-tenant rules can react to
        // each individual signature (fires on EVERY sign, not just completion).
        if (result.inspectionId) {
            c.var.services.automation.trigger({
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                triggerEvent: 'agreement.signer_signed',
                companyName: c.env.APP_NAME || 'OpenInspection',
                reportBaseUrl: c.env.APP_BASE_URL || '',
            }).catch(() => {});
        }

        // Envelope completion side-effects fire EXACTLY ONCE — gated on the
        // atomic single-fire flag from the service.
        if (result.envelopeCompletedNow) {
            await runEnvelopeCompletionPipeline(c, {
                requestId: result.requestId,
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                clientEmail: envelope.clientEmail ?? null,
                clientName: envelope.clientName ?? null,
                agreementId: envelope.agreementId,
            });
        }

        return c.json({ success: true as const }, 200);
    })
    .openapi(declineAgreementRoute, async (c) => {
        const { token } = c.req.valid('param');
        const { reason } = c.req.valid('json');
        const svc = c.var.services.agreement;

        // Track I-a — resolve the presented token to a SIGNER. 404 on miss.
        const resolved = await svc.getSignerByPresentedToken(token);
        if (!resolved) throw Errors.NotFound('Agreement request not found');
        const { signer, envelope } = resolved;

        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
        const ua = (c.req.header('user-agent') || '').slice(0, 200) || null;
        const country = c.req.header('cf-ipcountry') || null;

        // Per-signer audit append (audit-before-mutation, try/catch).
        try {
            await c.var.services.auditLog.append(envelope.tenantId, envelope.id, 'signer.declined', {
                envelopeId: envelope.id,
                signerId: signer.id,
                signerEmail: signer.email,
                reason: reason ?? null,
                country,
                ip,
                tsMs: Date.now(),
                ua,
            });
        } catch (e) {
            logger.warn('audit.append.signer-declined.failed', { requestId: envelope.id, signerId: signer.id, error: (e as Error).message });
        }

        const r = await svc.markDeclinedBySigner(token, reason);

        // Envelope-level automation fires ONLY when the WHOLE envelope declined.
        if (r.inspectionId && r.envelopeStatus === 'declined') {
            c.var.services.automation.trigger({
                tenantId: r.tenantId,
                inspectionId: r.inspectionId,
                triggerEvent: 'agreement.declined',
                companyName: c.env.APP_NAME || 'OpenInspection',
                reportBaseUrl: c.env.APP_BASE_URL || '',
            }).catch(() => {});
        }

        return c.json({ success: true as const }, 200);
    });

export default agreementRoutes;
