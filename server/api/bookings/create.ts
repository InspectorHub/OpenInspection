// Public create-booking sub-router (POST /book).
// Behavior-preserving extraction from bookings.ts — the route definition is
// byte-identical to the original; the handler resolves rate-limit + validated
// body + tenant id and delegates the fulfillment flow to
// bookingService.fulfillBooking() (single-point review preserved).
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { checkRateLimit } from '../../lib/rate-limit';
import {
    PublicBookingSchema,
    BookingResponseSchema
} from '../../lib/validations/booking.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';

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
                    schema: PublicBookingSchema.describe('The visitor\'s booking request: company, property, client, date, time window and services'),
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
    operationId: "createBookingBook",
    description: "Submit a public online booking for a company, identified by its slug in the body. Public and "
        + "rate-limited: no sign-in is needed. Where the deployment enforces the bot challenge, a valid "
        + "turnstileToken is required (403 otherwise), and a submission from an embedded widget (?embed=1) must "
        + "come from an origin on the company's widget allowlist. The booking is refused with 409 when online "
        + "booking is not set up or open, no inspector serves the area, or the requested date and window have no "
        + "free slot; a named inspector who is unavailable is refused rather than replaced. On success it creates "
        + "an inspection request holding one inspection per selected service (or a single inspection when no "
        + "services are sent), in the requested state and unpaid, assigned to the chosen or auto-selected "
        + "inspector, and consumes any new-inspection quota. It then records the client and any referring agent, "
        + "snapshots the deposit owed, emails the client a confirmation, pushes the appointment to the "
        + "inspector's connected calendar, and fires the booking-received automation; the last three happen "
        + "after the response is sent. The response gives the inspection and request ids and depositRequiredCents "
        + "(integer cents, 0 when none). Not idempotent: each call creates another booking."
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
        const tenantRow = await getDrizzle(c)
            .select({ id: tenants.id })
            .from(tenants).where(eq(tenants.slug, body.tenant)).get();
        if (!tenantRow) throw Errors.NotFound('Tenant not found.');
        const tenantId = tenantRow.id;

        return c.var.services.booking.fulfillBooking(c, tenantId, body);
    });

export default createBookingRoutes;
