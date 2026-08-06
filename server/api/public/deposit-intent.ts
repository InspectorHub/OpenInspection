/**
 * The one public route that can charge a stranger — the booking deposit.
 *
 * WHY IT IS NOT THE EXISTING PAY-INTENT ROUTE. `POST /api/public/inspections/
 * {id}/pay-intent` is gated on `resolveClientActor`: a live client/co_client
 * portal grant, presented as a `?token=` or the portal session cookie. An
 * anonymous booker who submitted the public form thirty seconds ago has
 * neither — no contact grant is minted at booking — so every deposit would
 * 401. It also charges the INVOICE, and a deposit exists precisely because
 * there is no invoice yet.
 *
 * WHAT AUTHORISES THE CALL, stated plainly because it is a public money route
 * and the honest answer is narrow: the inspection id, which was handed to this
 * browser in the response to its own booking submission and exists nowhere
 * else. That is the same capability posture as `/invoice/:id`. What it can be
 * abused for is bounded and worth writing down — a stranger holding the id can
 * learn what deposit is outstanding, and can PAY it. They cannot read the
 * booking, move it, or take money out. Everything else is refused by the four
 * conditions below, and 404 is the answer to all of them so the route cannot be
 * used to probe which ids exist.
 *
 * The intent it mints carries `metadata.kind = 'deposit'`. Nothing is recorded
 * here and nothing is recorded when the browser says the card cleared — the
 * ledger row is written by the Stripe webhook, which is the only party that
 * knows whether money actually moved.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import { checkRateLimit } from '../../lib/rate-limit';
import { logger } from '../../lib/logger';
import { inspections, tenantConfigs } from '../../lib/db/schema';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { outstandingDepositCents } from '../../services/booking/deposit';
import { DepositNotPayableError } from '../../lib/stripe-helpers';

const DepositIntentSchema = z.object({
    clientSecret: z.string().describe('Stripe PaymentIntent client secret for mounting Elements in the browser.'),
    publishableKey: z.string().describe("The tenant's own Stripe publishable key."),
    amountCents: z.number().int().describe('What this intent will charge, in integer cents — the deposit still outstanding.'),
    currency: z.string().describe('ISO 4217 currency the deposit is charged in.'),
});

const depositIntentRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{id}/deposit-intent',
    tags: ['bookings', 'public'],
    summary: 'Start a card payment for a booking deposit',
    request: {
        params: z.object({ id: z.string().describe('Inspection id returned by the booking submission.') }),
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(DepositIntentSchema) } }, description: 'PaymentIntent client secret + publishable key' },
        404: { description: 'No deposit is outstanding on this booking (also the answer for an unknown or already-started inspection)' },
        429: { description: 'Too many attempts from this address' },
        503: { description: 'Stripe is not configured for this workspace, or the charge could not be started' },
    },
    operationId: 'createBookingDepositIntent',
    description: "Mints a Stripe PaymentIntent for the deposit still outstanding on a booking, using the tenant's own Stripe keys. Public and unauthenticated: the inspection id returned by the booking submission is the capability. Records nothing — the ledger row is written when Stripe confirms the payment.",
}, { scopes: [], tier: 'extended' }));

const notFound = { success: false as const, error: { code: 'NOT_FOUND', message: 'No deposit is outstanding on this booking.' } };

const depositIntentRoutes = createApiRouter()
    .openapi(depositIntentRoute, async (c) => {
        await checkRateLimit(c, 'deposit-intent');
        const { id } = c.req.valid('param');
        // Set by resolveByInspectionId for the `/api/public/inspections/` prefix
        // — the same routing that puts this tenant's Stripe keys in c.env.
        const tenantId = (c.get('resolvedTenantId') || c.get('tenantId')) as string | null;
        if (!tenantId) return c.json(notFound, 404);

        const db = getDrizzle(c);
        const order = await db.select({ status: inspections.status })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!order) return c.json(notFound, 404);
        // A deposit holds a slot. Once the visit is under way or done it is not
        // a deposit any more, it is a payment, and payments go through the
        // invoice — which has an actual authenticated surface.
        if (order.status !== INSPECTION_STATUS.REQUESTED) return c.json(notFound, 404);

        const owed = await outstandingDepositCents(db, tenantId, id);
        if (!owed || owed.outstandingCents <= 0) return c.json(notFound, 404);

        const secretKey = c.env.STRIPE_SECRET_KEY;
        const publishableKey = c.env.STRIPE_PUBLISHABLE_KEY;
        if (!secretKey || !publishableKey) {
            return c.json({ success: false as const, error: { code: 'STRIPE_NOT_CONFIGURED', message: 'Online payment is not set up for this inspector.' } }, 503);
        }

        const cfg = await db.select({ currency: tenantConfigs.currency })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        const currency = cfg?.currency ?? 'USD';

        try {
            const { StripeService } = await import('../../services/stripe.service');
            const svc = new StripeService(secretKey);
            const { clientSecret } = await svc.createDepositPaymentIntent(
                { inspectionId: id, outstandingCents: owed.outstandingCents },
                { tenantId, currency },
            );
            return c.json({
                success: true as const,
                data: { clientSecret, publishableKey, amountCents: owed.outstandingCents, currency },
            }, 200);
        } catch (err) {
            // Raced with the webhook: the deposit landed between our read and
            // the mint. Nothing is owed, which is the 404 above's answer.
            if (err instanceof DepositNotPayableError) return c.json(notFound, 404);
            logger.error('Stripe deposit-intent failed', { inspectionId: id.slice(0, 8) }, err instanceof Error ? err : undefined);
            return c.json({ success: false as const, error: { code: 'STRIPE_ERROR', message: 'Payment could not be started. Please try again.' } }, 503);
        }
    });

export type PublicDepositIntentApi = typeof depositIntentRoutes;
export default depositIntentRoutes;
