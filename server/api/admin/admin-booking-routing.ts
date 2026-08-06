// Admin → Booking routing, rules, and the two anchors `closest` depends on.
//
// Kept off `admin-settings.ts` deliberately. Every tenant_configs column that
// goes through that file touches four places in it, and it sits exactly on its
// 754-line size baseline — but the stronger reason is that the geocode actions
// here call an external API, which has no business inside a generic
// tenant-config PATCH that fires whenever anyone edits a colour.
//
// The geocode is an EXPLICIT action with a visible result. `closest` is
// unusable without coordinates, and a workspace that never resolved its
// address must be able to see that on the page rather than discover it as
// bookings quietly routing by name for months.
import { createRoute } from '@hono/zod-openapi';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getDrizzle } from '../../lib/route-helpers';
import { Errors } from '../../lib/errors';
import { auditFromContext } from '../../lib/audit';
import { tenantConfigs, users } from '../../lib/db/schema';
import { geocodeAddressText } from '../../lib/places/geocode';
import { isRoutingStrategy, type RoutingStrategy } from '../../lib/booking/routing';
import { parseCutoffTime, parseMinLeadHours } from '../../lib/booking/booking-rules';
import {
    BookingRoutingSchema,
    ServiceOriginSchema,
    BookingRoutingResponseSchema,
    GeocodeResultResponseSchema,
} from '../../lib/validations/admin/booking-routing';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const ROLES = ['owner', 'manager'] as const;

const getRoutingRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/booking-routing',
    tags: ['admin'],
    summary: 'Booking routing strategy, rules, and geocode anchors',
    middleware: [requireRole(...ROLES)] as const,
    request: {},
    responses: {
        200: { content: { 'application/json': { schema: BookingRoutingResponseSchema } }, description: 'Routing configuration' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'getBookingRouting',
    description: 'Returns the routing strategy, lead time and cutoff, plus whether the company address and per-inspector service origins have coordinates — which is what decides whether `closest` can run at all.',
}, { scopes: ['admin'], tier: 'extended' }));

const patchRoutingRoute = createRoute(withMcpMetadata({
    method: 'patch', path: '/booking-routing',
    tags: ['admin'],
    summary: 'Update booking routing strategy and rules',
    middleware: [requireRole(...ROLES)] as const,
    request: { body: { content: { 'application/json': { schema: BookingRoutingSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: BookingRoutingResponseSchema } }, description: 'Updated configuration' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'patchBookingRouting',
    description: 'Patches routing strategy, minimum lead hours, and same-day cutoff. An omitted key is left alone; an explicit null on sameDayCutoffTime clears it.',
}, { scopes: ['admin'], tier: 'extended' }));

const geocodeCompanyRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/booking-routing/geocode-company',
    tags: ['admin'],
    summary: 'Resolve the company address to coordinates',
    middleware: [requireRole(...ROLES)] as const,
    request: {},
    responses: {
        200: { content: { 'application/json': { schema: GeocodeResultResponseSchema } }, description: 'Geocode outcome' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'geocodeCompanyAddress',
    description: 'Resolves the stored company address once and saves the coordinates. Returns the matched address so a wrong match is visible. A failure is reported in the body with a named reason, never as a silent null.',
}, { scopes: ['admin'], tier: 'extended' }));

const putServiceOriginRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/booking-routing/service-origin',
    tags: ['admin'],
    summary: 'Set or clear one inspector service origin',
    middleware: [requireRole(...ROLES)] as const,
    request: { body: { content: { 'application/json': { schema: ServiceOriginSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: GeocodeResultResponseSchema } }, description: 'Geocode outcome' },
        404: { description: 'Inspector not found in this tenant' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'putInspectorServiceOrigin',
    description: 'Geocodes and stores where one inspector starts their day. A null or empty address clears the override so they inherit the company coordinates.',
}, { scopes: ['admin'], tier: 'extended' }));

type Db = ReturnType<typeof getDrizzle>;

async function readRouting(db: Db, tenantId: string, geocodeAvailable: boolean) {
    const cfg = await db.select({
        routingStrategy: tenantConfigs.bookingRoutingStrategy,
        minLeadHours: tenantConfigs.bookingMinLeadHours,
        sameDayCutoffTime: tenantConfigs.bookingSameDayCutoffTime,
        companyAddress: tenantConfigs.companyAddress,
        companyLat: tenantConfigs.companyLat,
        companyLng: tenantConfigs.companyLng,
        companyGeocodedAt: tenantConfigs.companyGeocodedAt,
    }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

    const originRows = await db.select({
        userId: users.id,
        address: users.serviceOriginAddress,
        lat: users.serviceOriginLat,
        lng: users.serviceOriginLng,
    }).from(users).where(and(
        eq(users.tenantId, tenantId),
        or(isNotNull(users.serviceOriginAddress), isNotNull(users.serviceOriginLat)),
    )).all();

    return {
        routingStrategy: isRoutingStrategy(cfg?.routingStrategy) ? cfg.routingStrategy : 'first_available',
        minLeadHours: parseMinLeadHours(cfg?.minLeadHours),
        sameDayCutoffTime: parseCutoffTime(cfg?.sameDayCutoffTime),
        companyAddress: cfg?.companyAddress ?? null,
        companyLat: cfg?.companyLat ?? null,
        companyLng: cfg?.companyLng ?? null,
        companyGeocodedAt: cfg?.companyGeocodedAt ? new Date(cfg.companyGeocodedAt).toISOString() : null,
        geocodeAvailable,
        origins: originRows.map(r => ({
            userId: r.userId,
            address: r.address ?? null,
            lat: r.lat ?? null,
            lng: r.lng ?? null,
        })),
    };
}

/** Ensure the tenant_configs row exists before an UPDATE that assumes it. */
async function ensureConfigRow(db: Db, tenantId: string): Promise<void> {
    const row = await db.select({ tenantId: tenantConfigs.tenantId })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    if (!row) await db.insert(tenantConfigs).values({ tenantId, updatedAt: new Date() });
}

const adminBookingRoutingRoutes = createApiRouter()
    .openapi(getRoutingRoute, async (c) => {
        const data = await readRouting(getDrizzle(c), c.get('tenantId'), !!c.env.GOOGLE_PLACES_API_KEY);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(patchRoutingRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const db = getDrizzle(c);
        await ensureConfigRow(db, tenantId);

        const update: Record<string, unknown> = { updatedAt: new Date() };
        if (body.routingStrategy !== undefined) {
            update.bookingRoutingStrategy = body.routingStrategy as RoutingStrategy;
        }
        if (body.minLeadHours !== undefined) update.bookingMinLeadHours = body.minLeadHours;
        // `undefined` = untouched, `null` = cleared. Collapsing the two here is
        // how a PATCH silently loses a field the caller never mentioned.
        if (body.sameDayCutoffTime !== undefined) update.bookingSameDayCutoffTime = body.sameDayCutoffTime;

        await db.update(tenantConfigs).set(update).where(eq(tenantConfigs.tenantId, tenantId));
        auditFromContext(c, 'config.tenant_config.patch', 'tenant_config', {
            entityId: tenantId, metadata: { bookingRouting: body },
        });
        return c.json({
            success: true as const,
            data: await readRouting(db, tenantId, !!c.env.GOOGLE_PLACES_API_KEY),
        }, 200);
    })
    .openapi(geocodeCompanyRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);
        const apiKey = c.env.GOOGLE_PLACES_API_KEY;
        const miss = (reason: 'no_api_key' | 'no_address' | 'not_found') =>
            c.json({ success: true as const, data: { resolved: false, formatted: null, lat: null, lng: null, reason } }, 200);
        if (!apiKey) return miss('no_api_key');

        const cfg = await db.select({ companyAddress: tenantConfigs.companyAddress })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        const address = (cfg?.companyAddress ?? '').trim();
        if (!address) return miss('no_address');

        const place = await geocodeAddressText(apiKey, address);
        if (!place) return miss('not_found');

        await db.update(tenantConfigs).set({
            companyLat: place.lat,
            companyLng: place.lng,
            companyGeocodedAt: new Date(),
            updatedAt: new Date(),
        }).where(eq(tenantConfigs.tenantId, tenantId));
        auditFromContext(c, 'config.tenant_config.patch', 'tenant_config', {
            entityId: tenantId, metadata: { companyGeocode: place.formatted },
        });
        return c.json({
            success: true as const,
            data: { resolved: true, formatted: place.formatted, lat: place.lat, lng: place.lng, reason: null },
        }, 200);
    })
    .openapi(putServiceOriginRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { userId, address } = c.req.valid('json');
        const db = getDrizzle(c);

        const member = await db.select({ id: users.id }).from(users)
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).get();
        if (!member) throw Errors.NotFound('Inspector not found.');

        const trimmed = (address ?? '').trim();
        if (trimmed === '') {
            // Clearing all three columns is the ONLY way to inherit again —
            // leaving a stale lat/lng behind would keep routing to an office
            // the inspector no longer starts from.
            await db.update(users)
                .set({ serviceOriginAddress: null, serviceOriginLat: null, serviceOriginLng: null })
                .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
            auditFromContext(c, 'config.tenant_config.patch', 'user_service_origin', { entityId: userId });
            return c.json({
                success: true as const,
                data: { resolved: false, formatted: null, lat: null, lng: null, reason: 'no_address' as const },
            }, 200);
        }

        const apiKey = c.env.GOOGLE_PLACES_API_KEY;
        const place = apiKey ? await geocodeAddressText(apiKey, trimmed) : null;
        // The typed address is stored either way, so the setting is not lost
        // when Google is unreachable — but without coordinates this inspector
        // is simply not an input to `closest`, which the strategy reports.
        await db.update(users).set({
            serviceOriginAddress: trimmed,
            serviceOriginLat: place?.lat ?? null,
            serviceOriginLng: place?.lng ?? null,
        }).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
        auditFromContext(c, 'config.tenant_config.patch', 'user_service_origin', {
            entityId: userId, metadata: { resolved: !!place },
        });
        return c.json({
            success: true as const,
            data: {
                resolved: !!place,
                formatted: place?.formatted ?? null,
                lat: place?.lat ?? null,
                lng: place?.lng ?? null,
                reason: place ? null : (apiKey ? 'not_found' as const : 'no_api_key' as const),
            },
        }, 200);
    });

export type AdminBookingRoutingApi = typeof adminBookingRoutingRoutes;
export default adminBookingRoutingRoutes;
