// Public create-booking sub-router (POST /book).
// Behavior-preserving extraction from bookings.ts — the route definition is
// byte-identical to the original; the handler resolves rate-limit + validated
// body + tenant id and delegates the fulfillment flow to
// bookingService.fulfillBooking() (single-point review preserved).
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { checkRateLimit } from '../../lib/rate-limit';
import {
    PublicBookingSchema,
    BookingResponseSchema
} from '../../lib/validations/booking.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

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

const createBookingRoutes = createApiRouter()
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

        return c.var.services.booking.fulfillBooking(c, tenantId, body);
    });

export default createBookingRoutes;
