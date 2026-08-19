/**
 * Design System 0520 subsystem C phase 9 — billing summary read API.
 *
 * `GET /api/billing/summary` returns the per-tenant seat breakdown
 * that the /settings/billing page renders (and that team.tsx's
 * billing-pointer card embeds). Pure aggregator lives in
 * server/lib/billing-summary.ts so it can be unit-tested.
 *
 * Read-only — does not call Stripe. Subscription mutations land via
 * the portal's checkout + webhook pipeline (P7 + P8).
 */
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { eq } from 'drizzle-orm';
import { tenants } from '../lib/db/schema';
import { summariseSeats } from '../lib/billing-summary';
import { getSeatUsage } from '../features/seat-quota/usage';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { getDrizzle } from '../lib/route-helpers';

const summaryRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/summary',
    tags: ["invoices"],
    summary: 'Get tenant seat-quota summary (permanent + guests + cap)',
    responses: {
        200: { description: 'Summary' },
        404: { description: 'Tenant not found' },
    },
    operationId: "listBillingSummary",
    description: "Auto-generated placeholder for listBillingSummary (GET /summary, invoices domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const billingRoutes = createApiRouter()
    .openapi(summaryRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized();

        const db = getDrizzle(c);
        const tenant = await db.select({
            maxUsers: tenants.maxUsers,
            tier:     tenants.tier,
        }).from(tenants).where(eq(tenants.id, tenantId)).get();
        if (!tenant) throw Errors.NotFound('Tenant not found');

        // Seats come from `getSeatUsage`, not from a query written here. This
        // route used to count the tenant's users itself and forgot
        // `deleted_at IS NULL`, so a removed member — soft-deleted so their
        // inspection attribution survives — stayed on the bill after the
        // invite guard had already handed their seat back.
        //
        // `members`, not `used`: `used` includes the invitations that have been
        // sent and not accepted, because the quota has to reserve the seats they
        // can still claim. A bill is for the people who are actually here, and
        // it has to agree with the seat quantity the subscription is reconciled
        // against — which is the same `members` number.
        const usage = await getSeatUsage(tenantId, c.env.DB);
        const summary = summariseSeats(usage.members, tenant);

        // Portal Customer Portal redirect URL — surfaced for the "Manage
        // billing" CTA on the page. Omitted when the portal isn't wired
        // (standalone deployments) so the UI hides the button.
        const base = c.var.profile.billingPortalUrl;
        const data = base
            ? { ...summary, portalUrl: `${base}/api/billing/portal` }
            : summary;

        return c.json({ success: true as const, data }, 200);
    });

export type BillingApi = typeof billingRoutes;
export default billingRoutes;
