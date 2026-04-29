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

    const db = drizzle(c.env.DB);
    let inspectorId = body.inspectorId;

    if (!inspectorId) {
        const first = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId)).limit(1).get();
        if (!first) throw Errors.BadRequest('No active inspectors found.');
        inspectorId = first.id;
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
    await svc.signRequest(token, signatureBase64);
    return c.json({ success: true as const }, 200);
});

export default bookingsRoutes;
