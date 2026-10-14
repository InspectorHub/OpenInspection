import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { and, eq, isNull } from 'drizzle-orm';
import { SlugAvailabilityResponseSchema } from '../lib/validations/profile.schema';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { users, slugReservations } from '../lib/db/schema/tenant';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { getDrizzle } from '../lib/route-helpers';

/**
 * Booking #7 Sprint A — public slug-availability endpoint.
 *
 * Mounted at `/api/public/check/slug` inside the `/api/public/*` JWT
 * allowlist. tenantId resolves from slug via `tenantRouter`; an
 * unresolved tenant returns `{ available:false, reason:'invalid' }` so the
 * client can surface a friendly message instead of a 5xx.
 *
 * Agent Accounts A2 — adds an optional `namespace=agent` flag. Inspector
 * slugs are scoped per-tenant (the default), but agent slugs are global
 * across all agent users (tenant_id IS NULL, role='agent') so this branch
 * skips the per-tenant filter entirely.
 *
 * The query param is permissive (1..64 chars); canonical slug rules live in
 * `UserService.checkSlug` (reservations + uniqueness) and `SlugSchema`
 * (client-side format check).
 */
const checkSlugRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/check/slug',
    tags: ["profile", "public"],
    summary: 'Check whether a booking slug is available',
    request: {
        query: z.object({
            value: z.string().min(1).max(64).describe('The slug to test, as the user typed it.'),
            namespace: z.enum(['inspector', 'agent']).optional().describe('Which slug space to check: inspector (the default) is scoped to one company, agent is shared across all agent accounts.'),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(SlugAvailabilityResponseSchema),
                },
            },
            description: 'Availability check result',
        },
    },
    operationId: "listSlugCheckSlug",
    description: "Public, unauthenticated check of whether a booking slug can be claimed. Returns available true, or false with a reason: reserved (on the reserved list), taken (another user already has it), or invalid (no company could be resolved from the request). For a taken slug in the inspector namespace, up to 3 alternative suggestions are included. The inspector namespace (default) checks within the company resolved from the request's tenant context; the agent namespace checks across all agent accounts, with no company needed, and the value is lower-cased first. Read-only; it does not reserve the slug."
}, { scopes: [], tier: 'extended' }));

const publicSlugRoutes = createApiRouter()
    .openapi(checkSlugRoute, async (c) => {
        const { value, namespace } = c.req.valid('query');

        if (namespace === 'agent') {
            // Global agent-slug check: reserved blacklist OR another agent user
            // with this slug. tenant resolution irrelevant.
            const slug = value.trim().toLowerCase();
            const db = getDrizzle(c);
            const reserved = await db.select({ slug: slugReservations.slug })
                .from(slugReservations)
                .where(eq(slugReservations.slug, slug))
                .get();
            if (reserved) return c.json({ success: true as const, data: { available: false, reason: 'reserved' as const } }, 200);
            const taken = await db.select({ id: users.id })
                .from(users)
                .where(and(eq(users.slug, slug), isNull(users.tenantId), eq(users.role, 'agent')))
                .get();
            if (taken) return c.json({ success: true as const, data: { available: false, reason: 'taken' as const } }, 200);
            return c.json({ success: true as const, data: { available: true as const } }, 200);
        }

        const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
        if (!tenantId) {
            return c.json({ success: true as const, data: { available: false, reason: 'invalid' as const } }, 200);
        }
        const result = await c.var.services.user.checkSlug(tenantId, value);
        return c.json({ success: true as const, data: result }, 200);
    });

export type PublicSlugApi = typeof publicSlugRoutes;

export default publicSlugRoutes;
