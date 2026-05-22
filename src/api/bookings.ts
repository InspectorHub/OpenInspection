import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray } from 'drizzle-orm';
import { users, inspections, services as servicesTable, agentTenantLinks } from '../lib/db/schema';
import { isNull } from 'drizzle-orm';
import { createCalendarEvent } from './calendar';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { checkRateLimit } from '../lib/rate-limit';
import { logger } from '../lib/logger';
import { getBookingHost } from '../lib/url';
import {
    PublicBookingSchema,
    InspectorsResponseSchema,
    AvailabilityResponseSchema,
    BookingResponseSchema
} from '../lib/validations/booking.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const bookingsRoutes = new OpenAPIHono<HonoConfig>();

/**
 * GET /api/public/inspectors
 */
const listInspectorsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspectors',
    tags: ["bookings", "public"],
    summary: "List booking inspectors for current tenant",
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: InspectorsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listBookingInspectors",
    description: "Auto-generated placeholder for listBookingInspectors (GET /inspectors, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

bookingsRoutes.openapi(listInspectorsRoute, async (c) => {
    const tenantId = c.get('tenantId') || c.get('requestedSubdomain');
    if (!tenantId) throw Errors.Forbidden('Tenant context missing.');

    const service = c.var.services.booking;
    const inspectors = await service.listInspectors(tenantId);
    return c.json({ success: true, data: { inspectors } }, 200);
});

/**
 * GET /api/public/services — Sprint 2 S2-2.
 * Lists active services so the public booking page can render the multi-
 * service selector. Only id / name / price / duration / templateId are
 * exposed; internal notes are not surfaced.
 */
const listPublicServicesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/services',
    tags: ["bookings", "public"],
    summary: 'List active services for public booking',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({
                            services: z.array(z.object({
                                id:              z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
                                name:            z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
                                description:     z.string().nullable().describe('TODO describe description field for the OpenInspection MCP integration'),
                                price:           z.number().describe('TODO describe price field for the OpenInspection MCP integration'),
                                durationMinutes: z.number().nullable().describe('TODO describe durationMinutes field for the OpenInspection MCP integration'),
                            })).describe('TODO describe services field for the OpenInspection MCP integration'),
                        }),
                    }),
                },
            },
            description: 'List of active services',
        },
    },
    operationId: "listBookingServices",
    description: "Auto-generated placeholder for listBookingServices (GET /services, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

bookingsRoutes.openapi(listPublicServicesRoute, async (c) => {
    const tenantId = c.get('tenantId') || c.get('requestedSubdomain');
    if (!tenantId) throw Errors.Forbidden('Tenant context missing.');
    const db = drizzle(c.env.DB);
    const rows = await db.select({
        id:              servicesTable.id,
        name:            servicesTable.name,
        description:     servicesTable.description,
        price:           servicesTable.price,
        durationMinutes: servicesTable.durationMinutes,
        active:          servicesTable.active,
        templateId:      servicesTable.templateId,
    }).from(servicesTable)
        .where(eq(servicesTable.tenantId, tenantId))
        .all();
    // Only expose services that are active AND have a template wired up.
    const visible = rows.filter(r => r.active && r.templateId);
    return c.json({
        success: true,
        data: {
            services: visible.map(r => ({
                id:              r.id,
                name:            r.name,
                description:     r.description ?? null,
                price:           r.price,
                durationMinutes: r.durationMinutes ?? null,
            })),
        },
    }, 200);
});

/**
 * GET /api/public/availability/:inspectorId
 */
const getAvailabilityRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/availability/{inspectorId}',
    tags: ["bookings", "public"],
    summary: "Get booking availability for current tenant",
    request: {
        params: z.object({ inspectorId: z.string().uuid().describe('TODO describe inspectorId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        query: z.object({
            start: z.string().optional().describe('TODO describe start field for the OpenInspection MCP integration'),
            end: z.string().optional().describe('TODO describe end field for the OpenInspection MCP integration'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AvailabilityResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "getBookingAvailability",
    description: "Auto-generated placeholder for getBookingAvailability (GET /availability/{inspectorId}, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

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
const createBookingRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/book',
    tags: ["bookings", "public"],
    summary: 'Submit a new booking',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: PublicBookingSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: BookingResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "createBookingBook",
    description: "Auto-generated placeholder for createBookingBook (POST /book, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

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

    // UC-A-1 — agent referral attribution. Resolve `?ref=<agentSlug>` (sent
    // through the form as agentRefSlug) to a contacts.id in this tenant.
    // Two requirements both need to hold:
    //   1. A global agent user with that slug exists.
    //   2. They have an `active` agent_tenant_links row for THIS tenant whose
    //      inspectorContactId points at the agent's contact row.
    // Either failure leaves referredByAgentId null — bookings with bad slugs
    // still succeed; we just don't credit the (unknown) agent.
    let resolvedAgentContactId: string | null = null;
    if (body.agentRefSlug) {
        try {
            const agent = await db.select({ id: users.id })
                .from(users)
                .where(and(
                    eq(users.slug, body.agentRefSlug),
                    isNull(users.tenantId),
                    eq(users.role, 'agent'),
                ))
                .get();
            if (agent) {
                const link = await db.select({ contactId: agentTenantLinks.inspectorContactId })
                    .from(agentTenantLinks)
                    .where(and(
                        eq(agentTenantLinks.agentUserId, agent.id),
                        eq(agentTenantLinks.tenantId, tenantId),
                        eq(agentTenantLinks.status, 'active'),
                    ))
                    .get();
                resolvedAgentContactId = link?.contactId ?? null;
            }
        } catch (err) {
            logger.warn('booking.agentRef.resolve.failed', {
                slug: body.agentRefSlug,
                tenantId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // Booking #7 Sprint A — inspectorId is now required. The legacy
    // "first-inspector-wins" fallback was removed because the customer-facing
    // booking page now resolves an inspector via /book/<slug>, and the form
    // submits the resolved id as a hidden field. Submissions without it are a
    // bug or a tampered payload, not a routine fallback case.
    const inspectorId = body.inspectorId;
    if (!inspectorId) {
        throw Errors.BadRequest('Booking link missing inspector context. Please use the link your inspector provided.');
    }

    // Spec 3C — enforce inspector availability + availability_overrides + existing-bookings collision check.
    // Reuses BookingService.getAvailableSlots (returns [{time:'HH:MM', available:bool}, ...]).
    //
    // Sprint 1 C-6 — translate the 4 customer-facing window options into the
    // existing internal time-slot model. all-day reuses the morning slot
    // (08:00); custom maps to the user-provided customTime (HH:mm).
    let requestedTime: string;
    switch (body.timeSlot) {
        case 'morning':   requestedTime = '08:00'; break;
        case 'afternoon': requestedTime = '13:00'; break;
        case 'all-day':   requestedTime = '08:00'; break;
        case 'custom':    requestedTime = body.customTime ?? '08:00'; break;
    }
    const slots = await service.getAvailableSlots(tenantId, inspectorId, body.date);
    const targetSlot = slots.find(s => s.time === requestedTime);
    if (!targetSlot || !targetSlot.available) {
        throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
    }

    // Sprint 2 S2-2 — When the customer selects multiple services, we route
    // through InspectionRequestService so the resulting inspections are
    // grouped under a parent request. The legacy single-service flow still
    // creates a one-inspection request implicitly so dashboards can group
    // every booking the same way.
    const startIso = `${body.date}T${requestedTime}:00Z`;
    const inspectionRequestService = c.var.services.inspectionRequest;
    let createdRequestId: string;
    let primaryInspectionId: string;
    let allInspectionIds: string[] = [];

    if (body.services && body.services.length > 0) {
        const serviceIds = body.services.map(s => s.serviceId);
        const svcRows = await db.select().from(servicesTable)
            .where(and(eq(servicesTable.tenantId, tenantId), inArray(servicesTable.id, serviceIds)))
            .all();
        if (svcRows.length !== serviceIds.length) {
            throw Errors.BadRequest('One or more services were not found.');
        }
        const subs = svcRows.map(s => {
            const sub: { templateId: string; price: number } = {
                templateId: s.templateId ?? '',
                price:      s.price ?? 0,
            };
            if (!sub.templateId) throw Errors.BadRequest(`Service '${s.name}' has no template configured.`);
            return sub;
        });
        const created = await inspectionRequestService.create(tenantId, {
            clientName:      body.clientName,
            clientEmail:     body.clientEmail,
            propertyAddress: body.address,
            scheduledAt:     startIso,
            inspectorId,
            referredByAgentId: resolvedAgentContactId,
        }, subs);
        createdRequestId = created.id;
        allInspectionIds = created.inspections.map(i => i.id);
        primaryInspectionId = allInspectionIds[0] ?? '';
    } else {
        primaryInspectionId = crypto.randomUUID();
        createdRequestId = `req-${primaryInspectionId}`;
        const now = new Date();
        // Insert one-inspection request first so the FK is satisfied.
        await db.insert((await import('../lib/db/schema')).inspectionRequests).values({
            id:              createdRequestId,
            tenantId,
            clientName:      body.clientName,
            clientEmail:     body.clientEmail,
            propertyAddress: body.address,
            scheduledAt:     startIso,
            status:          'pending',
            totalAmount:     0,
            paymentStatus:   'unpaid',
            createdAt:       now,
            updatedAt:       now,
        });
        await db.insert(inspections).values({
            id: primaryInspectionId,
            tenantId,
            inspectorId,
            propertyAddress: body.address,
            clientName: body.clientName,
            clientEmail: body.clientEmail,
            date: body.date,
            status: 'draft',
            paymentStatus: 'unpaid',
            price: 0,
            requestId: createdRequestId,
            referredByAgentId: resolvedAgentContactId,
            createdAt: now
        });
        allInspectionIds = [primaryInspectionId];
    }
    const inspectionId = primaryInspectionId;

    // Sprint 1 C-6 — map window option to a human-readable label for the
    // calendar event + confirmation email.
    const windowLabel: Record<typeof body.timeSlot, string> = {
        'morning':   'Morning (8:00 AM – 12:00 PM)',
        'afternoon': 'Afternoon (12:00 PM – 4:00 PM)',
        'all-day':   'All day (8:00 AM – 5:00 PM)',
        'custom':    body.customTime ? `${body.customTime}` : 'Custom time',
    };

    // Async tasks
    c.executionCtx.waitUntil((async () => {
        const inspector = await db.select().from(users).where(eq(users.id, inspectorId!)).get();
        if (inspector?.googleRefreshToken && inspector?.googleCalendarId) {
            const startDateTime = `${body.date}T${requestedTime}:00Z`;
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

        // Sprint 1 C-10 — build the ICS event so the confirmation email
        // carries a calendar invite the customer can import into Apple
        // Calendar / Google Calendar. Duration defaults to 3 hours, with
        // 4 hours for morning/afternoon windows and 9 hours for all-day.
        const startMs = new Date(`${body.date}T${requestedTime}:00Z`).getTime();
        const durationHours = body.timeSlot === 'all-day' ? 9
            : body.timeSlot === 'morning' || body.timeSlot === 'afternoon' ? 4
            : 3;
        const endMs = startMs + durationHours * 60 * 60 * 1000;
        // Booking-confirmation greeting falls back to the brand, never the
        // inspector's inbox — keeps the email looking professional even if a
        // legacy account is missing a display name.
        const inspectorName = inspector?.name || c.env.APP_NAME || 'Your inspector';
        const inspectorEmail = inspector?.email || c.env.SENDER_EMAIL || `noreply@${c.env.APP_NAME?.toLowerCase().replace(/\s/g, '') || 'inspector'}.com`;

        // Sprint B-4a — append inspector signature so customers can rebook
        // with the same inspector via the per-inspector booking link.
        const sigInspector = inspector ? {
            name:          inspector.name ?? null,
            email:         inspector.email ?? null,
            phone:         inspector.phone ?? null,
            licenseNumber: inspector.licenseNumber ?? null,
            slug:          inspector.slug ?? null,
        } : undefined;
        await emailService.sendBookingConfirmation(
            body.clientEmail,
            body.clientName,
            body.address,
            body.date,
            windowLabel[body.timeSlot],
            {
                uid:            `inspection-${inspectionId}`,
                summary:        `Home Inspection at ${body.address}`,
                description:    `Inspector: ${inspectorName}\nWindow: ${windowLabel[body.timeSlot]}\n\nWe will send your detailed report within 24 hours of completion.`,
                location:       body.address,
                start:          new Date(startMs),
                end:            new Date(endMs),
                organizerEmail: inspectorEmail,
                organizerName:  inspectorName,
            },
            sigInspector,
            getBookingHost(c),
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
        data: {
            success: true,
            inspectionId,
            requestId: createdRequestId,
            inspectionIds: allInspectionIds,
        }
    }, 200);
});

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
                            status: z.enum(['pending', 'viewed', 'signed']).describe('TODO describe status field for the OpenInspection MCP integration'),
                            clientName: z.string().nullable().describe('TODO describe clientName field for the OpenInspection MCP integration'),
                            agreementName: z.string().describe('TODO describe agreementName field for the OpenInspection MCP integration'),
                            agreementContent: z.string().describe('TODO describe agreementContent field for the OpenInspection MCP integration'),
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
                    schema: z.object({ signatureBase64: z.string().min(1).describe('TODO describe signatureBase64 field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration'),
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
        const tenantSlug = c.get('requestedSubdomain') ?? '';
        c.executionCtx.waitUntil((async () => {
            try {
                await c.env.SIGN_COMPLETION_WORKFLOW!.create({
                    id: request.id, // workflow id = requestId for idempotency / re-run
                    params: { requestId: request.id, tenantId: request.tenantId, tenantSlug, token },
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

    // Sprint 1 C-8 — confirmation email to the signer (and CC the inspector
    // so both parties have a record). Spec 5H envelope verifier URL is the
    // tamper-evident receipt; we pass it as the email CTA.
    if (request && signed.clientEmail) {
        c.executionCtx.waitUntil((async () => {
            try {
                const baseUrl = (c.env.APP_BASE_URL || '').replace(/\/$/, '') || (() => {
                    const host = c.req.header('host');
                    return host ? `https://${host}` : '';
                })();
                const verifyUrl = baseUrl ? `${baseUrl}/verify/${signed.id}` : `/verify/${signed.id}`;
                const confirmationId = signed.id.replace(/-/g, '').slice(0, 8).toUpperCase();
                const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;

                // Look up inspector record so we can CC them and append the
                // Sprint B-4c signature footer.
                let inspectorEmail: string | null = null;
                let inspectorRow: typeof users.$inferSelect | null = null;
                let propertyAddress = 'your inspection';
                if (signed.inspectionId) {
                    const db = drizzle(c.env.DB);
                    const insp = await db.select().from(inspections)
                        .where(eq(inspections.id, signed.inspectionId)).get();
                    if (insp?.propertyAddress) propertyAddress = insp.propertyAddress;
                    if (insp?.inspectorId) {
                        const insRow = await db.select().from(users)
                            .where(eq(users.id, insp.inspectorId)).get();
                        inspectorEmail = insRow?.email ?? null;
                        inspectorRow   = insRow ?? null;
                    }
                }

                const sigInspector = inspectorRow ? {
                    name:          inspectorRow.name ?? null,
                    email:         inspectorRow.email ?? null,
                    phone:         inspectorRow.phone ?? null,
                    licenseNumber: inspectorRow.licenseNumber ?? null,
                    slug:          inspectorRow.slug ?? null,
                } : undefined;

                await c.var.services.email.sendAgreementSignedConfirmation(
                    signed.clientEmail,
                    inspectorEmail ? [inspectorEmail] : [],
                    signed.clientName || 'Client',
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

    return c.json({ success: true as const }, 200);
});

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

/**
 * Sprint 1 C-5 — Public address autocomplete proxy for the unauthenticated
 * /book page. The internal `/api/places/autocomplete` endpoint is JWT-gated,
 * so we expose a thin public forwarder here with three guarantees:
 *
 *   1. Token never leaves the worker (kept off the wire entirely).
 *   2. If no token is configured, returns `{ data: [], reason: 'NO_API_KEY' }`
 *      and the client falls back silently to plain-text input.
 *   3. Rate-limited via the shared booking rate limiter to deter scraping.
 *
 * This implementation uses Google Places (existing `GOOGLE_PLACES_API_KEY`
 * binding) — same upstream that powers the dashboard's authenticated
 * autocomplete. The plan language uses "Mapbox" as a placeholder for any
 * geocoder; we align with the existing infrastructure.
 */
const publicGeocodeRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/geocode',
    tags: ["bookings", "public"],
    summary: 'Address autocomplete proxy (public, rate-limited)',
    request: {
        query: z.object({
            q: z.string().min(1).max(200).openapi({ example: '1005 S Gay' }).describe('TODO describe q field for the OpenInspection MCP integration'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        data: z.array(z.object({
                            label:   z.string().describe('TODO describe label field for the OpenInspection MCP integration'),
                            line1:   z.string().describe('TODO describe line1 field for the OpenInspection MCP integration'),
                            city:    z.string().nullable().describe('TODO describe city field for the OpenInspection MCP integration'),
                            state:   z.string().nullable().describe('TODO describe state field for the OpenInspection MCP integration'),
                            zip:     z.string().nullable().describe('TODO describe zip field for the OpenInspection MCP integration'),
                            placeId: z.string().describe('TODO describe placeId field for the OpenInspection MCP integration'),
                        })).describe('TODO describe data field for the OpenInspection MCP integration'),
                        reason: z.enum(['NO_API_KEY', 'UPSTREAM_ERROR']).optional().describe('TODO describe reason field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Autocomplete suggestions or fallback reason',
        },
    },
    operationId: "geocodeBooking",
    description: "Auto-generated placeholder for geocodeBooking (GET /geocode, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

bookingsRoutes.openapi(publicGeocodeRoute, async (c) => {
    await checkRateLimit(c, 'book');
    const { q } = c.req.valid('query');
    if (q.length < 3) {
        return c.json({ data: [] }, 200);
    }
    const apiKey = c.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
        return c.json({ data: [], reason: 'NO_API_KEY' as const }, 200);
    }

    try {
        const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
        url.searchParams.set('input', q);
        url.searchParams.set('types', 'address');
        url.searchParams.set('components', 'country:us');
        url.searchParams.set('key', apiKey);
        const res = await fetch(url.toString());
        if (!res.ok) {
            logger.warn('[public.geocode] upstream error', { status: res.status });
            return c.json({ data: [], reason: 'UPSTREAM_ERROR' as const }, 200);
        }
        const j = await res.json() as {
            status: string;
            predictions?: Array<{
                place_id: string;
                description: string;
                terms?: Array<{ value: string }>;
                structured_formatting?: { main_text?: string; secondary_text?: string };
            }>;
        };
        if (j.status !== 'OK' && j.status !== 'ZERO_RESULTS') {
            logger.warn('[public.geocode] upstream status', { status: j.status });
            return c.json({ data: [], reason: 'UPSTREAM_ERROR' as const }, 200);
        }
        // Best-effort split of secondary_text into city / state / zip — Google
        // Places returns "City, ST 12345" for US addresses. We do a lenient
        // regex split; clients should treat these as hints, not authoritative.
        const data = (j.predictions ?? []).slice(0, 5).map(p => {
            const main = p.structured_formatting?.main_text || p.description;
            const secondary = p.structured_formatting?.secondary_text || '';
            const m = secondary.match(/^([^,]+),\s*([A-Z]{2})\s*(\d{5})?/);
            return {
                label:   p.description,
                line1:   main,
                city:    m?.[1] ?? null,
                state:   m?.[2] ?? null,
                zip:     m?.[3] ?? null,
                placeId: p.place_id,
            };
        });
        return c.json({ data }, 200);
    } catch (e) {
        logger.error('[public.geocode] exception', {}, e instanceof Error ? e : undefined);
        return c.json({ data: [], reason: 'UPSTREAM_ERROR' as const }, 200);
    }
});

export default bookingsRoutes;
