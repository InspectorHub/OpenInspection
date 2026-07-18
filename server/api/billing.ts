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
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, users as usersTbl } from '../lib/db/schema';
import { summariseSeats } from '../lib/billing-summary';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from "../lib/route-metadata-standards";

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

        const db = drizzle(c.env.DB);
        const tenant = await db.select({
            maxUsers: tenants.maxUsers,
            tier:     tenants.tier,
        }).from(tenants).where(eq(tenants.id, tenantId)).get();
        if (!tenant) throw Errors.NotFound('Tenant not found');

        const rows = await db.select({
            id: usersTbl.id,
        }).from(usersTbl).where(eq(usersTbl.tenantId, tenantId)).all();

        const summary = summariseSeats(rows, tenant);

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
