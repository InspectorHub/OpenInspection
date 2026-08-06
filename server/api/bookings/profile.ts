/**
 * The two public booking PROFILE reads — what a company (or one inspector)
 * offers, and whether they are taking bookings at all.
 *
 * Split out of `server/api/bookings.ts` on size, and they are the right ninety
 * lines to move: everything else in that module answers "what times are free"
 * or "here is a booking", while these two answer "who are you and what do you
 * sell". They are also the only two routes in the public booking surface that
 * are raw `.get()` rather than `createRoute` — a shape difference that reads as
 * an accident when they sit interleaved with the OpenAPI ones and as a fact
 * about their age when they sit together.
 *
 * Mounted at `/` by the aggregator, so the external paths are unchanged and
 * Hono still merges the RPC types — `api.bookings.book[":tenant"].$get` keeps
 * working in the app exactly as before.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { users, services as servicesTable, tenants, availability, tenantConfigs } from '../../lib/db/schema';
import { checkRateLimit } from '../../lib/rate-limit';
import { getDrizzle } from '../../lib/route-helpers';

const bookingProfileRoutes = createApiRouter()
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
        const db = getDrizzle(c);

        const tenantRow = await db.select({ id: tenants.id, name: tenants.name })
            .from(tenants).where(eq(tenants.slug, tenant)).get();
        if (!tenantRow) return c.json({ success: false, error: { code: 'not_found', message: 'Tenant not found' } }, 404);

        const booking = c.var.services.booking;
        const [svcRows, config, qualified] = await Promise.all([
            db.select({
                id: servicesTable.id, name: servicesTable.name, price: servicesTable.price,
                durationMinutes: servicesTable.durationMinutes, templateId: servicesTable.templateId,
                active: servicesTable.active, depositPolicy: servicesTable.depositPolicy,
            }).from(servicesTable).where(eq(servicesTable.tenantId, tenantRow.id)).all(),
            db.select({
                allowInspectorChoice: tenantConfigs.allowInspectorChoice,
                conciergeReviewRequired: tenantConfigs.conciergeReviewRequired,
                currency: tenantConfigs.currency,
                depositPolicy: tenantConfigs.depositPolicy,
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
                // The deposit is QUOTED here and RESOLVED again on the server at
                // booking time from the same catalogue rows. The client copy has
                // to exist — a charge a client only discovers after clicking Book
                // is a chargeback and a review — but it is a quote, never the
                // authority: `inspections.deposit_required_cents` is what the
                // server froze, and only the server writes it.
                currency: config?.currency ?? 'USD',
                depositPolicy: config?.depositPolicy ?? null,
                services: visible.map(s => ({
                    id: s.id, name: s.name, price: Number(s.price || 0), duration: Number(s.durationMinutes || 60),
                    depositPolicy: s.depositPolicy ?? null,
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
        const db = getDrizzle(c);

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

export default bookingProfileRoutes;
