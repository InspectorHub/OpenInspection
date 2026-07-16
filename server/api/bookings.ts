// Public bookings API aggregator.
//
// This module is intentionally thin: the public booking surface (company page
// data + slot availability + create-booking + token-gated agreement
// sign/decline/checkout) was split into focused sub-routers under
// `server/api/bookings/` (behavior-preserving — handler bodies + route
// definitions are byte-identical to the original single-file router). The
// create-booking fulfillment flow moved into `bookingService.fulfillBooking()`
// to preserve single-point review.
//
// The sub-routers are mounted at `/` so the external path surface is IDENTICAL
// to the original chain (every route path is absolute, e.g. `/book`,
// `/agreements/:token`). Hono merges each sub-router's OpenAPI + RPC types, so
// `typeof bookingsRoutes` (exported as `BookingsApi`) is preserved for the
// `hono/client` consumers. `server/index.ts` mounts the default export at
// `/api/public` unchanged.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray } from 'drizzle-orm';
import { users, services as servicesTable, tenants, availability, tenantConfigs } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { checkRateLimit } from '../lib/rate-limit';
import { logger } from '../lib/logger';
import {
    InspectorsResponseSchema,
    AvailabilityResponseSchema
} from '../lib/validations/booking.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import createBookingRoutes from './bookings/create';
import agreementRoutes from './bookings/agreement';

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
                            holidayAdvisory: z.object({
                                date: z.string().describe('Civil date YYYY-MM-DD'),
                                name: z.string().describe('Holiday display name'),
                            }).optional().describe('Present when public holiday policy is advisory and the date is in the catalog'),
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
    .route('/', createBookingRoutes)
    .route('/', agreementRoutes)
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
        const slots = all.slots.map(s => ({
            time: s.time,
            available: inspectorId ? s.inspectorIds.includes(inspectorId) : s.available,
        }));
        return c.json({
            success: true,
            data: {
                slots,
                ...(all.holidayAdvisory ? { holidayAdvisory: all.holidayAdvisory } : {}),
            },
        }, 200);
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
            db.select({
                allowInspectorChoice: tenantConfigs.allowInspectorChoice,
                conciergeReviewRequired: tenantConfigs.conciergeReviewRequired,
            })
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
                conciergeReviewRequired: !!config?.conciergeReviewRequired,
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
