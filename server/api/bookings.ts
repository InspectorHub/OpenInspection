import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { users, inspections, services as servicesTable, agentTenantLinks, tenants, availability, tenantConfigs, agreements, invoices } from '../lib/db/schema';
import { isNull } from 'drizzle-orm';
import { createCalendarEvent } from './calendar';
import { Errors } from '../lib/errors';
import { checkRateLimit } from '../lib/rate-limit';
import { logger } from '../lib/logger';
import { getBookingHost, getBaseUrl } from '../lib/url';
import {
    PublicBookingSchema,
    InspectorsResponseSchema,
    AvailabilityResponseSchema,
    BookingResponseSchema
} from '../lib/validations/booking.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { syncInspectionAssignments } from '../lib/db/assignment-links';
import { runEnvelopeCompletionPipeline } from '../lib/sign-effects';

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
            // A-17 — the tenant slug is authoritative (B-16 pattern): this public
            // endpoint is not slug-routed, so context resolution never applies.
            tenant: z.string().min(1).openapi({ example: 'acme-inspections' }).describe('Tenant slug from the booking page URL; resolved server-side to the tenant id.'),
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

/**
 * GET /api/public/slots — company-level aggregated bookable time slots (IA-26).
 */
const getTenantSlotsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/slots',
    tags: ['bookings', 'public'],
    summary: 'Company-level bookable time slots for a date',
    description: 'Returns the union of qualified inspectors\' bookable 30-minute slots for the given date (IA-26 aggregation). When inspectorId is supplied the result is restricted to that inspector (deep-link / client-choice flow). Free-inspector identities are never exposed on this public surface.',
    request: {
        query: z.object({
            tenant: z.string().min(1).openapi({ example: 'acme-inspections' }).describe('Tenant slug from the booking page URL; resolved server-side to the tenant id.'),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-07-01' }).describe('Date to query, YYYY-MM-DD.'),
            serviceIds: z.string().optional().openapi({ example: 'svc-1,svc-2' }).describe('Comma-separated service ids; restricts the qualified-inspector set.'),
            inspectorId: z.string().uuid().optional().describe('Restrict slots to a single inspector (client choice / deep link).'),
        }).describe('Tenant slot query parameters'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().describe('Whether the request succeeded'),
                        data: z.object({
                            slots: z.array(z.object({
                                time: z.string().describe('Slot start time, HH:MM (24h)'),
                                available: z.boolean().describe('Whether at least one qualified inspector is free at this time'),
                            })).describe('Bookable 30-minute slot grid for the requested date'),
                        }).describe('Aggregated slot data'),
                    }).describe('Tenant slots response'),
                },
            },
            description: 'Success',
        },
    },
    operationId: 'getTenantBookingSlots',
}, { scopes: ['read'], tier: 'extended' }));

export const bookingsRoutes = createApiRouter()
    .openapi(listInspectorsRoute, async (c) => {
        const tenantId = c.get('tenantId') || c.get('requestedTenantSlug');
        if (!tenantId) throw Errors.Forbidden('Tenant context missing.');

        const service = c.var.services.booking;
        const inspectors = await service.listInspectors(tenantId);
        return c.json({ success: true, data: inspectors }, 200);
    })
    .openapi(listPublicServicesRoute, async (c) => {
        const tenantId = c.get('tenantId') || c.get('requestedTenantSlug');
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
    })
    .openapi(getAvailabilityRoute, async (c) => {
        // A-17 — public read endpoint: rate-limit like the other public surfaces.
        await checkRateLimit(c, 'availability');

        const { inspectorId } = c.req.valid('param');
        const { start, end, tenant } = c.req.valid('query');

        // A-17 — slug-authoritative tenant resolution (B-16 pattern). The old
        // context fallback (tenantId || requestedTenantSlug) pointed at the fixed
        // tenant in standalone and at NOTHING in saas mode (this path is not
        // slug-routed), so it 403'd there. No context fallback.
        const tenantRow = await drizzle(c.env.DB)
            .select({ id: tenants.id })
            .from(tenants).where(eq(tenants.slug, tenant)).get();
        if (!tenantRow) throw Errors.NotFound('Tenant not found.');
        const tenantId = tenantRow.id;

        const startDate = start || new Date().toISOString().split('T')[0];
        const endDate = end || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const service = c.var.services.booking;
        const result = await service.getAvailability(tenantId, inspectorId, startDate, endDate);
        return c.json({ success: true, data: result }, 200);
    })
    .openapi(createBookingRoute, async (c) => {
        await checkRateLimit(c, 'book');

        const body = c.req.valid('json');
        // B-16 — the submitted tenant slug is authoritative, mirroring how the
        // GET /book/:tenant/:slug page data resolves. The old context fallback
        // (SINGLE_TENANT_ID / requestedTenantSlug) pointed at the WRONG tenant
        // whenever the fixed tenant differed from the page's tenant, and at no
        // tenant at all in saas mode (this path is not slug-routed).
        const tenantRow = await drizzle(c.env.DB)
            .select({ id: tenants.id })
            .from(tenants).where(eq(tenants.slug, body.tenant)).get();
        if (!tenantRow) throw Errors.NotFound('Tenant not found.');
        const tenantId = tenantRow.id;

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

        // IA-26 — inspectorId is now OPTIONAL. The company-level booking page
        // submits without one (pure auto-assign); the legacy per-inspector
        // deep link and the allowInspectorChoice dropdown still send it.
        const serviceIdsForQual = (body.services ?? []).map(s => s.serviceId);
        let inspectorId = body.inspectorId ?? null;

        if (inspectorId) {
            // B-16 — a supplied inspector must belong to the resolved tenant;
            // a mismatched id (tampered payload or stale form) must not reach
            // into another tenant's availability/inspection space.
            const inspectorRow = await db.select({ id: users.id }).from(users)
                .where(and(eq(users.id, inspectorId), eq(users.tenantId, tenantId)))
                .get();
            if (!inspectorRow) throw Errors.NotFound('Inspector not found.');
        }

        // B-16 (company-wide) — distinguish "nobody configured working hours"
        // from a genuinely taken slot, with the honest not-open copy.
        // qualifiedIds is computed once here and threaded through to avoid
        // duplicate getQualifiedInspectorIds lookups in hasAnyHours / getTenantSlots.
        const qualifiedIds = await service.getQualifiedInspectorIds(tenantId, serviceIdsForQual);
        const bookingOpen = await service.hasAnyHours(tenantId, serviceIdsForQual, qualifiedIds);
        if (!bookingOpen) {
            throw Errors.Conflict('Online booking is not open yet. Please contact the company directly to schedule.');
        }

        // Spec 3C / IA-26 — availability enforcement now runs on the tenant
        // aggregation: a slot is bookable iff at least one QUALIFIED inspector
        // is free (or the requested one, when the client chose).
        let requestedTime: string;
        switch (body.timeSlot) {
            case 'morning':   requestedTime = '08:00'; break;
            case 'afternoon': requestedTime = '13:00'; break;
            case 'all-day':   requestedTime = '08:00'; break;
            case 'custom':    requestedTime = body.customTime ?? '08:00'; break;
        }
        // KNOWN RACE (advisory check): the slot read and the inspection insert
        // below are not atomic and D1 offers no row locks, so two concurrent
        // submits for the last slot can both pass and double-book the same
        // inspector (deterministic pickInspector converges on one person).
        // Accepted for launch traffic; a post-insert recheck/compensation is
        // tracked in the backlog. Do NOT "fix" by randomizing the pick — the
        // determinism is intentional (idempotent re-submits).
        const slots = await service.getTenantSlots(tenantId, body.date, serviceIdsForQual, qualifiedIds);
        const target = slots.find(s => s.time === requestedTime);
        const freeIds = (target?.inspectorIds ?? []).filter(id => !inspectorId || id === inspectorId);
        if (freeIds.length === 0) {
            throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
        }
        if (!inspectorId) {
            inspectorId = await service.pickInspector(tenantId, freeIds);
            if (!inspectorId) throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
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
                // B-28 adjacent fix — store the full start ISO like the
                // multi-service path (inspection-request.service create) does.
                // Busy checks read HH:MM at slice(11,16) of this value; the old
                // bare `body.date` never marked the slot busy, so even
                // sequential double-booking succeeded.
                date: startIso,
                status: 'draft',
                paymentStatus: 'unpaid',
                price: 0,
                requestId: createdRequestId,
                referredByAgentId: resolvedAgentContactId,
                createdAt: now
            });
            // DB-8: mirror assignment into inspection_inspectors link table.
            // Non-fatal — the link table is a denormalized mirror; a sync failure
            // must never 500 an anonymous booker whose inspection row already committed.
            try {
                await syncInspectionAssignments(db, tenantId, primaryInspectionId, { inspectorId });
            } catch (e) {
                logger.error('booking.assignment-sync.failed', { inspectionId: primaryInspectionId }, e instanceof Error ? e : undefined);
            }
            allInspectionIds = [primaryInspectionId];
        }
        const inspectionId = primaryInspectionId;

        // B-28 — post-insert TOCTOU recheck. Runs after our insert and BEFORE
        // any side effect (confirmation email, calendar event, notifications)
        // so a losing booker only ever sees the 409, never a confirmation for
        // a booking that then vanishes. The arbitration is deterministic
        // (earliest (createdAt, id) wins), so of two racers exactly one
        // self-compensates here while the other proceeds untouched.
        const verdict = await service.arbitrateSlotRace(
            tenantId, inspectorId!, body.date, requestedTime, createdRequestId,
        );
        if (verdict === 'lose') {
            await service.revokeBooking(tenantId, createdRequestId);
            throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
        }

        // IA-18 (#111) — capture the booker as a Client contact and link it to
        // ALL inspections this booking created so their client appears in
        // Contacts and on the inspection hub People card.
        //
        // Placement: AFTER arbitration. A losing booker self-revokes and throws
        // above, so we never stamp a contact onto inspections that were just
        // deleted. (A stray contact row is harmless on its own — what we avoid
        // is a clientContactId pointing at vanished inspections.) It also runs
        // BEFORE the side-effect block to keep the synchronous DB writes
        // grouped before async waitUntil work.
        //
        // Non-fatal: a booking must NEVER fail because of contact bookkeeping.
        // Any error is logged (NO client email — only inspection ids + message)
        // and swallowed; the inspection rows already committed regardless.
        let bookingClientContactId: string | null = null;
        if (body.clientEmail || body.clientName) {
            try {
                const { id: clientContactId } = await c.var.services.contact.upsertClientContact(tenantId, {
                    name:  body.clientName,
                    email: body.clientEmail,
                    type:  'client',
                });
                bookingClientContactId = clientContactId;
                await db.update(inspections)
                    .set({ clientContactId })
                    .where(and(
                        inArray(inspections.id, allInspectionIds),
                        eq(inspections.tenantId, tenantId),
                    ));
            } catch (e) {
                logger.warn('booking.client-contact.upsert.failed', {
                    inspectionIds: allInspectionIds,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        // Track L (D6, path A) — self-book SMS opt-in. The checkbox is unchecked by
        // default; when ticked we record a `granted` consent event (captured_via=
        // booking_form) keyed on the client contact. Non-fatal: a consent write must
        // never fail the booking (the inspection rows already committed).
        if (body.smsOptin && bookingClientContactId) {
            try {
                const { SmsConsentService } = await import('../services/sms-consent.service');
                await new SmsConsentService(c.env.DB).record(
                    tenantId, bookingClientContactId, 'granted', 'booking_form',
                    { ip: c.req.header('CF-Connecting-IP'), userAgent: c.req.header('User-Agent') },
                );
            } catch (e) {
                logger.warn('booking.sms-optin.record.failed', {
                    inspectionId, error: e instanceof Error ? e.message : String(e),
                });
            }
        }

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
            // Track L (D6, path B) — double-opt-in link injected at the RENDERER
            // level (not gated on any automation rule) so disabling a rule never
            // removes the only opt-in path. The token self-describes (tenant,
            // contact) — see lib/sms/optin-token.ts. Best-effort: a token failure
            // simply omits the link.
            let smsOptinUrl: string | undefined;
            if (bookingClientContactId && c.env.JWT_SECRET) {
                try {
                    const { mintOptinToken } = await import('../lib/sms/optin-token');
                    const token = await mintOptinToken(tenantId, bookingClientContactId, c.env.JWT_SECRET);
                    smsOptinUrl = `${getBaseUrl(c)}/sms-optin/${encodeURIComponent(token)}`;
                } catch (e) {
                    logger.warn('booking.sms-optin.mint.failed', { inspectionId, error: e instanceof Error ? e.message : String(e) });
                }
            }

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
                smsOptinUrl,
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
    })
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
                status: envelope.status as 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired',
                clientName: envelope.clientName ?? null,
                agreementName: agreementRow?.name ?? 'Agreement',
                agreementContent: snapshot.content,
                signer: {
                    name: signer.name,
                    role: signer.role as 'client' | 'co_client' | 'agent' | 'other',
                    // Re-read this signer's status post-view (markViewedBySigner may
                    // have flipped it from sent → viewed).
                    status: (signers.find((s) => s.id === signer.id)?.status ?? signer.status) as
                        'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired',
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

        const branding = await db.select({ siteName: tenantConfigs.siteName, primaryColor: tenantConfigs.primaryColor })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

        const invoiceStatus = invoiceRow
            ? (invoiceRow.paidAt ? 'paid' : invoiceRow.partialPaidAt ? 'partial' : 'unpaid')
            : null;

        return c.json({
            success: true as const,
            data: {
                signer: {
                    name: signer.name,
                    role: signer.role as 'client' | 'co_client' | 'agent' | 'other',
                    status: (signers.find((s) => s.id === signer.id)?.status ?? signer.status) as
                        'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired',
                },
                agreement: {
                    name: agreementRow?.name ?? 'Agreement',
                    content: snapshot.content,
                    contentHash: snapshot.hash,
                },
                envelope: {
                    status: envelope.status as 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired',
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
                    companyName: branding?.siteName ?? 'OpenInspection',
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
    })
    .openapi(publicGeocodeRoute, async (c) => {
        await checkRateLimit(c, 'book');
        const { q } = c.req.valid('query');
        if (q.length < 3) {
            return c.json({ success: true, data: [] }, 200);
        }
        const apiKey = c.env.GOOGLE_PLACES_API_KEY;
        if (!apiKey) {
            return c.json({ success: true, data: [], meta: { reason: 'NO_API_KEY' as const } }, 200);
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
                return c.json({ success: true, data: [], meta: { reason: 'UPSTREAM_ERROR' as const } }, 200);
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
                return c.json({ success: true, data: [], meta: { reason: 'UPSTREAM_ERROR' as const } }, 200);
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
            return c.json({ success: true, data }, 200);
        } catch (e) {
            logger.error('[public.geocode] exception', {}, e instanceof Error ? e : undefined);
            return c.json({ success: true, data: [], meta: { reason: 'UPSTREAM_ERROR' as const } }, 200);
        }
    })
    .openapi(getTenantSlotsRoute, async (c) => {
        await checkRateLimit(c, 'availability');
        const { tenant, date, serviceIds, inspectorId } = c.req.valid('query');
        const tenantRow = await drizzle(c.env.DB).select({ id: tenants.id })
            .from(tenants).where(eq(tenants.slug, tenant)).get();
        if (!tenantRow) throw Errors.NotFound('Tenant not found.');
        const ids = serviceIds ? serviceIds.split(',').filter(Boolean) : [];
        const all = await c.var.services.booking.getTenantSlots(tenantRow.id, date, ids);
        const slots = all.map(s => ({
            time: s.time,
            available: inspectorId ? s.inspectorIds.includes(inspectorId) : s.available,
        }));
        return c.json({ success: true, data: { slots } }, 200);
    })
    /**
     * GET /api/public/book/:tenant — company-level booking profile (IA-26).
     * The canonical public entry. bookingOpen is company-wide: true iff ANY
     * qualified staff member has configured recurring hours. The inspectors
     * list is only exposed when the tenant enabled allowInspectorChoice.
     *
     * Round-trip budget: tenant lookup (1) + 3 parallel (services, config,
     * getQualifiedInspectorIds) + 1 availability scan shared by bookingOpen
     * and the choice list + 1 conditional inspector fetch = 5 max.
     * The previous implementation ran up to 6 serial round-trips by calling
     * hasAnyHours (which itself called getQualifiedInspectorIds + availability)
     * and then re-running both calls inside the allowChoice branch.
     */
    .get('/book/:tenant', async (c) => {
        await checkRateLimit(c, 'availability');
        const { tenant } = c.req.param();
        const db = drizzle(c.env.DB);

        const tenantRow = await db.select({ id: tenants.id, name: tenants.name })
            .from(tenants).where(eq(tenants.slug, tenant)).get();
        if (!tenantRow) return c.json({ success: false, error: { code: 'not_found', message: 'Tenant not found' } }, 404);

        const booking = c.var.services.booking;
        const [svcRows, config, qualified] = await Promise.all([
            db.select({
                id: servicesTable.id, name: servicesTable.name, price: servicesTable.price,
                durationMinutes: servicesTable.durationMinutes, templateId: servicesTable.templateId,
                active: servicesTable.active,
            }).from(servicesTable).where(eq(servicesTable.tenantId, tenantRow.id)).all(),
            db.select({ allowInspectorChoice: tenantConfigs.allowInspectorChoice })
                .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantRow.id)).get(),
            booking.getQualifiedInspectorIds(tenantRow.id, []),
        ]);
        const visible = svcRows.filter(s => s.active && s.templateId);
        const allowChoice = !!config?.allowInspectorChoice;

        // One availability scan serves BOTH bookingOpen and the choice list.
        const withHours = qualified.length > 0
            ? await db.selectDistinct({ inspectorId: availability.inspectorId })
                .from(availability)
                .where(and(eq(availability.tenantId, tenantRow.id), inArray(availability.inspectorId, qualified)))
                .all()
            : [];
        const hourIds = withHours.map(r => r.inspectorId);
        const bookingOpen = hourIds.length > 0;

        let inspectors: Array<{ id: string; name: string | null; photoUrl: string | null }> = [];
        if (allowChoice && hourIds.length > 0) {
            inspectors = await db.select({ id: users.id, name: users.name, photoUrl: users.photoUrl })
                .from(users).where(and(eq(users.tenantId, tenantRow.id), inArray(users.id, hourIds))).all();
            inspectors.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
        }

        return c.json({
            success: true,
            data: {
                company: tenantRow.name,
                turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
                bookingOpen,
                allowInspectorChoice: allowChoice,
                inspectors,
                services: visible.map(s => ({
                    id: s.id, name: s.name, price: Number(s.price || 0), duration: Number(s.durationMinutes || 60),
                })),
            },
        });
    })
    /**
     * GET /api/public/book/:tenant/:slug — public booking profile
     * Returns inspector name, services, and availability for the booking page.
     */
    .get('/book/:tenant/:slug', async (c) => {
        await checkRateLimit(c, 'availability');
        const { tenant, slug } = c.req.param();
        const db = drizzle(c.env.DB);

        // Resolve tenant by slug
        const tenantRow = await db.select({ id: tenants.id, name: tenants.name })
            .from(tenants).where(eq(tenants.slug, tenant)).get();
        if (!tenantRow) return c.json({ success: false, error: { code: 'not_found', message: 'Tenant not found' } }, 404);

        // Find inspector by slug within tenant
        const inspector = await db.select({
            id: users.id, name: users.name, slug: users.slug, photoUrl: users.photoUrl,
        }).from(users).where(and(eq(users.tenantId, tenantRow.id), eq(users.slug, slug))).get();
        if (!inspector) return c.json({ success: false, error: { code: 'not_found', message: 'Inspector not found' } }, 404);

        // Get active services
        const svcRows = await db.select({
            id: servicesTable.id, name: servicesTable.name, price: servicesTable.price,
            durationMinutes: servicesTable.durationMinutes,
        }).from(servicesTable).where(and(eq(servicesTable.tenantId, tenantRow.id), eq(servicesTable.active, true))).all();

        // B-16 — online booking is "open" only once the inspector has working
        // hours configured; the page renders an honest not-open state otherwise.
        const hasHours = await db.select({ id: availability.id }).from(availability)
            .where(and(eq(availability.tenantId, tenantRow.id), eq(availability.inspectorId, inspector.id)))
            .limit(1)
            .get();

        return c.json({
            success: true,
            data: {
                inspectorId: inspector.id,
                name: inspector.name,
                company: tenantRow.name,
                avatar: inspector.photoUrl,
                turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
                bookingOpen: !!hasHours,
                services: svcRows.map(s => ({
                    id: s.id, name: s.name, price: Number(s.price || 0), duration: Number(s.durationMinutes || 60),
                })),
            },
        });
    });

export type BookingsApi = typeof bookingsRoutes;

export default bookingsRoutes;
