import { and, eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { tenantConfigs, tenants, users } from '../lib/db/schema';
import { mintInspectorIcsToken } from '../lib/calendar/inspector-ics-token';
import { isAdminRole } from '../lib/auth/roles';
import { getDrizzle } from '../lib/route-helpers';

/**
 * GET /api/calendar/ics-links
 *
 * The three subscribe feeds for the My Schedule catalog, as PATHS.
 *
 * Paths, not absolute URLs, and that is not a style choice: this API is
 * mounted IN-PROCESS behind the React Router server, so `getBaseUrl(c)`
 * here resolves to the API worker's own host (127.0.0.1:8787 in dev), not
 * the origin the browser is on. Composing the absolute URL server-side
 * produced a link that looked right and was dead the moment anyone pasted
 * it into a calendar app. The origin is the browser's to supply; the server
 * still decides everything that matters — the sealed token only it can
 * mint, and the owner-only company feed.
 */
const calendarIcsLinkRoutes = createApiRouter()
    .get('/ics-links', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ success: false, error: { message: 'Not authenticated' } }, 401);
    const tenantId = c.get('tenantId') as string;
    const db = getDrizzle(c);

    const me = await db.select({ slug: users.slug }).from(users)
        .where(and(eq(users.id, user.sub), eq(users.tenantId, tenantId)))
        .get();
    const tenant = await db.select({ slug: tenants.slug }).from(tenants)
        .where(eq(tenants.id, tenantId)).get();

    // Busy feed: public slug, no PII in the body. Absent until the
    // inspector has a slug — rendering a broken link is worse than none.
    const busyPath = me?.slug && tenant?.slug
        ? `/inspector/${tenant.slug}/${me.slug}/calendar.ics`
        : null;

    // Schedule feed: carries addresses, so a sealed token rather than the
    // guessable slug.
    const schedulePath = c.env.JWT_SECRET
        ? `/api/ics/inspector/${encodeURIComponent(
            await mintInspectorIcsToken(tenantId, user.sub, c.env.JWT_SECRET),
        )}`
        : null;

    // Company feed: every inspection in the tenant. Owner/manager only.
    let companyPath: string | null = null;
    if (isAdminRole(c.get('userRole'))) {
        const cfg = await db.select({ icsToken: tenantConfigs.icsToken })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        if (cfg?.icsToken) companyPath = `/api/ics/${cfg.icsToken}`;
    }

    return c.json({ success: true, data: { busyPath, schedulePath, companyPath } }, 200);
})

export default calendarIcsLinkRoutes;
