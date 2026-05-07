import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users, inspections } from '../lib/db/schema';
import { createCalendarEvent } from './calendar';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { checkRateLimit } from '../lib/rate-limit';
import { logger } from '../lib/logger';
import { 
    PublicBookingSchema, 
    InspectorsResponseSchema, 
    AvailabilityResponseSchema, 
    BookingResponseSchema 
} from '../lib/validations/booking.schema';

const bookingsRoutes = new OpenAPIHono<HonoConfig>();

/**
 * GET /api/public/inspectors
 */
const listInspectorsRoute = createRoute({
    method: 'get',
    path: '/inspectors',
    tags: ['Public'],
    summary: 'List available inspectors',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: InspectorsResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

bookingsRoutes.openapi(listInspectorsRoute, async (c) => {
    const tenantId = c.get('tenantId') || c.get('requestedSubdomain');
    if (!tenantId) throw Errors.Forbidden('Tenant context missing.');

    const service = c.var.services.booking;
    const inspectors = await service.listInspectors(tenantId);
    return c.json({ success: true, data: { inspectors } }, 200);
});

/**
 * GET /api/public/availability/:inspectorId
 */
const getAvailabilityRoute = createRoute({
    method: 'get',
    path: '/availability/{inspectorId}',
    tags: ['Public'],
    summary: 'Get inspector availability',
    request: {
        params: z.object({ inspectorId: z.string().uuid() }),
        query: z.object({
            start: z.string().optional(),
            end: z.string().optional(),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AvailabilityResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

bookingsRoutes.openapi(getAvailabilityRoute, async (c) => {
    const tenantId = c.get('tenantId') || c.get('requestedSubdomain');
    if (!tenantId) throw Errors.Forbidden('Tenant context missing.');

    const { inspectorId } = c.req.valid('param');
    const { start, end } = c.req.valid('query');

    const startDate = start || new Date().toISOString().split('T')[0];
    const endDate = end || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const service = c.var.services.booking;
    const result = await service.getAvailability(tenantId, inspectorId, startDate, endDate);
    return c.json({ success: true, data: result }, 200);
});

/**
 * POST /api/public/book
 */
const createBookingRoute = createRoute({
    method: 'post',
    path: '/book',
    tags: ['Public'],
    summary: 'Submit a new booking',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: PublicBookingSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: BookingResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

bookingsRoutes.openapi(createBookingRoute, async (c) => {
    await checkRateLimit(c, 'book');

    const body = c.req.valid('json');
    const tenantId = c.get('tenantId') || c.get('requestedSubdomain');
    if (!tenantId) throw Errors.Forbidden('Tenant context missing.');

    const service = c.var.services.booking;

    // Bot Protection — always enforce when secret is configured
    if (c.env.TURNSTILE_SECRET_KEY) {
        if (!body.turnstileToken) throw Errors.Forbidden('Security verification token missing.');
        const isValid = await service.verifyBotProtection(body.turnstileToken, c.env.TURNSTILE_SECRET_KEY);
        if (!isValid) throw Errors.Forbidden('Security verification failed.');
    }

    // B2: when the booking originates from an embedded widget, enforce
    // per-tenant origin allowlist. Non-embed (direct /book visit) submissions
    // are unaffected.
    const isWidgetSubmit = c.req.query('embed') === '1';
    const originHeader = c.req.header('origin');
    if (isWidgetSubmit) {
        const ok = await c.var.services.widget.isOriginAllowed(tenantId, originHeader ?? null);
        if (!ok) {
            await c.var.services.widget.recordEvent(tenantId, 'error', { origin: originHeader, reason: 'origin_not_allowed' });
            throw Errors.Forbidden('Widget submissions from this origin are not allowed for this workspace.');
        }
    }

    const db = drizzle(c.env.DB);
    let inspectorId = body.inspectorId;

    if (!inspectorId) {
        const first = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId)).limit(1).get();
        if (!first) throw Errors.BadRequest('No active inspectors found.');
        inspectorId = first.id;
    }

    // Spec 3C — enforce inspector availability + availability_overrides + existing-bookings collision check.
    // Reuses BookingService.getAvailableSlots (returns [{time:'HH:MM', available:bool}, ...]).
    const slots = await service.getAvailableSlots(tenantId, inspectorId, body.date);
    const requestedTime = body.timeSlot === 'morning' ? '08:00' : '13:00';
    const targetSlot = slots.find(s => s.time === requestedTime);
    if (!targetSlot || !targetSlot.available) {
        throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
    }

    const inspectionId = crypto.randomUUID();
    await db.insert(inspections).values({
        id: inspectionId,
        tenantId,
        inspectorId,
        propertyAddress: body.address,
        clientName: body.clientName,
        clientEmail: body.clientEmail,
        date: body.date,
        status: 'draft',
        paymentStatus: 'unpaid',
        price: 0,
        createdAt: new Date()
    });

    // Async tasks
    c.executionCtx.waitUntil((async () => {
        const inspector = await db.select().from(users).where(eq(users.id, inspectorId!)).get();
        if (inspector?.googleRefreshToken && inspector?.googleCalendarId) {
            const startDateTime = `${body.date}T${body.timeSlot === 'morning' ? '08:00:00' : '13:00:00'}Z`;
            await createCalendarEvent(
                c.env.GOOGLE_CLIENT_ID,
                c.env.GOOGLE_CLIENT_SECRET,
                inspector.googleRefreshToken,
                inspector.googleCalendarId,
                `Inspection: ${body.address}`,
                startDateTime,
                body.address
            ).catch(e => logger.error('Calendar sync failed', {}, e instanceof Error ? e : undefined));
        }

        const emailService = c.var.services.email;
        await emailService.sendBookingConfirmation(
            body.clientEmail,
            body.clientName,
            body.address,
            body.date,
            body.timeSlot === 'morning' ? 'Morning (08:00 - 12:00)' : 'Afternoon (13:00 - 17:00)'
        ).catch(e => logger.error('Booking confirmation email failed', {}, e instanceof Error ? e : undefined));
    })());

    if (isWidgetSubmit) {
        c.executionCtx.waitUntil(
            c.var.services.widget.recordEvent(tenantId, 'success', { origin: originHeader, inspectionId })
        );
    }

    // B3: in-app notification for the inspector workspace
    c.executionCtx.waitUntil(
        c.var.services.notification.createForAllAdmins(tenantId, {
            type: 'booking.received',
            title: `New booking — ${body.address ?? 'no address'}`,
            body: body.clientName ? `From ${body.clientName}` : null,
            entityType: 'inspection',
            entityId: inspectionId,
            metadata: { source: isWidgetSubmit ? 'widget' : 'public_form' },
        })
    );

    return c.json({
        success: true,
        data: { success: true, inspectionId }
    }, 200);
});

/**
 * GET /api/public/agreements/:token — fetch agreement content + mark viewed
 */
const getAgreementByTokenRoute = createRoute({
    method: 'get',
    path: '/agreements/:token',
    tags: ['Public'],
    summary: 'Get agreement for signing (public, token-gated)',
    request: { params: z.object({ token: z.string().min(1) }) },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.object({
                            status: z.enum(['pending', 'viewed', 'signed']),
                            clientName: z.string().nullable(),
                            agreementName: z.string(),
                            agreementContent: z.string(),
                        }),
                    }),
                },
            },
            description: 'Agreement content',
        },
    },
});

bookingsRoutes.openapi(getAgreementByTokenRoute, async (c) => {
    const { token } = c.req.valid('param');
    const svc = c.var.services.agreement;
    const { request, agreement } = await svc.getAgreementByToken(token);
    await svc.markViewed(token);
    return c.json({
        success: true as const,
        data: {
            status: request.status as 'pending' | 'viewed' | 'signed',
            clientName: request.clientName ?? null,
            agreementName: agreement.name,
            agreementContent: agreement.content,
        },
    }, 200);
});

/**
 * POST /api/public/agreements/:token/sign — submit client signature
 */
const signAgreementRoute = createRoute({
    method: 'post',
    path: '/agreements/:token/sign',
    tags: ['Public'],
    summary: 'Submit client signature (public, token-gated)',
    request: {
        params: z.object({ token: z.string().min(1) }),
        body: {
            content: {
                'application/json': {
                    schema: z.object({ signatureBase64: z.string().min(1) }),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(true) }),
                },
            },
            description: 'Signed',
        },
    },
});

bookingsRoutes.openapi(signAgreementRoute, async (c) => {
    const { token } = c.req.valid('param');
    const { signatureBase64 } = c.req.valid('json');
    const svc = c.var.services.agreement;

    // Spec 5H P0 — append audit BEFORE flipping DB status so chain integrity
    // survives a partial failure (audit-before-mutation per spec §2.4).
    // Look up the request to get tenantId + requestId for the chain.
    const request = await svc.getRequestByToken(token);
    if (request) {
        try {
            const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
            const ua = (c.req.header('user-agent') || '').slice(0, 200) || null;
            const country = c.req.header('cf-ipcountry') || null;
            // Hash the signature image for cert reference (full image stored in DB)
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
            await c.var.services.auditLog.append(request.tenantId, request.id, 'agreement.signed', {
                country,
                envelopeId: request.id,
                ip,
                signatureImageHash: sigHash ? `sha256:${sigHash}` : null,
                tsMs: Date.now(),
                ua,
            });
        } catch (e) {
            logger.warn('audit.append.signed.failed', { token: token.slice(0, 8), error: (e as Error).message });
        }
    }

    const signed = await svc.signRequest(token, signatureBase64);

    // Spec 5H P1 — trigger async sign-completion workflow (renders signed.pdf
    // + Certificate of Completion + appends 'workflow.complete' to audit chain).
    // Fire-and-forget: client doesn't wait. Workflow has its own retry policy.
    if (request && c.env.SIGN_COMPLETION_WORKFLOW) {
        c.executionCtx.waitUntil((async () => {
            try {
                await c.env.SIGN_COMPLETION_WORKFLOW!.create({
                    id: request.id, // workflow id = requestId for idempotency / re-run
                    params: { requestId: request.id, tenantId: request.tenantId, token },
                });
            } catch (e) {
                logger.warn('sign-workflow.create.failed', { requestId: request.id, error: (e as Error).message });
            }
        })());
    }

    // Round 14 free-tier structured log — kept alongside the persisted audit
    // for redundancy in case D1 write fails after Workers commit.
    logger.info('agreement.signed.audit', {
        event: 'agreement.signed.audit',
        token: token.slice(0, 8) + '…',
        tenantId: signed.tenantId,
        clientName: signed.clientName ?? null,
        signedAt: new Date().toISOString(),
        signerIp: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
        signerUserAgent: (c.req.header('user-agent') || '').slice(0, 200) || null,
        signerCountry: c.req.header('cf-ipcountry') || null,
    });

    // B3: in-app notification — fetch agreement name for richer title
    c.executionCtx.waitUntil((async () => {
        try {
            const agreement = await svc.getAgreementByToken(token);
            await c.var.services.notification.createForAllAdmins(signed.tenantId, {
                type: 'agreement.signed',
                title: `Agreement signed — ${agreement.agreement.name}`,
                body: signed.clientName ? `By ${signed.clientName}` : null,
                entityType: 'agreement',
                entityId: signed.id,
                metadata: {
                    agreementId: signed.agreementId,
                    inspectionId: signed.inspectionId ?? null,
                    clientEmail: signed.clientEmail,
                },
            });
        } catch (e) {
            logger.error('agreement.signed notification failed', {}, e instanceof Error ? e : undefined);
        }
    })());

    // Spec 2A — also fire automation event so per-tenant rules can react
    if (signed.inspectionId) {
        c.var.services.automation.trigger({
            tenantId: signed.tenantId,
            inspectionId: signed.inspectionId,
            triggerEvent: 'agreement.signed',
            companyName: c.env.APP_NAME || 'OpenInspection',
            reportBaseUrl: c.env.APP_BASE_URL || '',
        }).catch(() => {});
    }

    return c.json({ success: true as const }, 200);
});

/**
 * POST /api/public/agreements/:token/decline — client declines the agreement
 */
const declineAgreementRoute = createRoute({
    method: 'post',
    path: '/agreements/:token/decline',
    tags: ['Public'],
    summary: 'Decline agreement (public, token-gated)',
    request: {
        params: z.object({ token: z.string().min(1) }),
        body: {
            content: {
                'application/json': {
                    schema: z.object({ reason: z.string().max(500).optional() }),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Declined',
        },
    },
});

bookingsRoutes.openapi(declineAgreementRoute, async (c) => {
    const { token } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const svc = c.var.services.agreement;
    const r = await svc.markDeclined(token, reason);

    // Fire automation event so per-tenant rules can notify the inspector
    if (r.inspectionId) {
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

export default bookingsRoutes;
