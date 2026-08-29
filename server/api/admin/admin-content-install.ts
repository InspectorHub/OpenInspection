// Admin → bundled-content install sub-router.
//
// One route. It lives beside `admin-data.ts` rather than inside it for the same
// reason `admin-data-import.ts` does — the file-size ceiling — and is mounted at
// `/` by the admin aggregator, so its path surface is the absolute
// `/api/admin/data/install-bundled-content` regardless of which file holds it.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

/**
 * Install the starter content this release ships that this workspace does not
 * already have.
 *
 * Calls the SAME canonical seeder both provisioning paths use — SaaS via
 * `server/portal/apply-commands.ts`, standalone via `/setup`
 * (`server/api/auth.ts`). There is no second implementation and there must
 * never be one.
 *
 * WHY THIS EXISTS. The seeder was anchored to `/setup`, which refuses forever
 * once a tenant user exists, so content only ever arrived on day one. An upgrade
 * carries schema (`db:migrate:remote` is in the deploy chain) and code, and
 * carried no content at all. This is the missing third thing.
 *
 * WHAT IT DOES NOT DO. The skip check is by NAME, so this ADDS what is new and
 * never refreshes what exists — and a renamed row does not match, so it comes
 * back as a second copy. The UI copy says "install what's new" for that reason;
 * do not retitle it "sync".
 *
 * Deliberately NOT gated on deployment mode: both modes need it, and both
 * already call this seeder with this signature. Deliberately NOT mounted under
 * `/api/integration/*` either — that prefix 404s outside SaaS, which would
 * reproduce the exact gap this route closes.
 */
const StarterContentInstallResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        inspectionTemplatesSeeded:  z.number().describe('New inspection templates inserted.'),
        agreementTemplatesSeeded:   z.number().describe('New agreement templates inserted.'),
        cannedCommentsSeeded:       z.number().describe('New canned comments inserted.'),
        eventTypesSeeded:           z.number().describe('New event types inserted.'),
        tagsSeeded:                 z.number().describe('New tags inserted.'),
        recommendationsSeeded:      z.number().describe('New repair-item comments inserted.'),
        ratingSystemsSeeded:        z.number().describe('New rating systems inserted.'),
        marketplaceLibrariesSeeded: z.number().describe(
            'Rows in the global marketplace_libraries catalogue this run created OR refreshed. '
            + 'A refresh is a pack whose semver moved in this release; the row keeps its id and '
            + 'its download count.',
        ),
        contractorTypesSeeded:      z.number().describe('New contractor types inserted.'),
        servicesSeeded:             z.number().describe('New sellable services inserted.'),
    }).describe(
        'Counts of rows ADDED — plus, for the global catalogue only, rows refreshed to this '
        + 'release. All zero means the workspace already had everything this release ships.',
    ),
}).openapi('StarterContentInstallResponse');

const installBundledContentRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/data/install-bundled-content',
    tags: ['admin'],
    summary: 'Install the starter content this release ships that the workspace lacks',
    // Owner-only: this writes library content for the whole workspace, and
    // unlike the template routes there is no per-verb capability to hang it on
    // yet (see OI #307).
    middleware: [requireRole('owner')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: StarterContentInstallResponseSchema } },
            description: 'Counts of what was added. Adds only — nothing already present is refreshed.',
        },
    },
    operationId: 'installBundledContent',
    description: 'Idempotently adds the bundled starter content (templates, agreements, canned comments, event types, tags, repair items, rating systems, contractor types, services) this workspace does not already have. Matching is by name, so existing rows are never updated and a renamed row is re-added under its original name.',
}, { scopes: ['admin'], tier: 'extended' }));

const adminContentInstallRoutes = createApiRouter()
    .openapi(installBundledContentRoute, async (c) => {
        const tenantId = c.get('tenantId');
        // Dynamic import mirrors both existing callers: the fixture payload
        // (seed templates, 250+ canned comments, …) is only pulled in when
        // someone actually installs.
        const { seedStarterContent } = await import('../../services/starter-content.service');
        const data = await seedStarterContent(c.env.DB, tenantId);

        auditFromContext(c, 'data.import', 'starter_content', { metadata: { ...data } });

        return c.json({ success: true as const, data }, 200);
    });

export default adminContentInstallRoutes;
