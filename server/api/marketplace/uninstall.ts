/**
 * Un-installing a catalogue entry — the route half.
 *
 * ── WHY THIS EXISTS AS A FILE ───────────────────────────────────────────────
 * `MarketplaceService.uninstall` landed with no caller at all: no route, no
 * action, no button, while both locale files already shipped the copy an
 * inspector sees when a template is retired because it was uninstalled — a state
 * nobody could reach. The kind-halves gate reported 6/6 green throughout,
 * because it reads branches inside the service and reachability is outside what
 * it can see. This is the missing half of that.
 *
 * It is its own sub-router because `marketplace.ts` is at its size ceiling, the
 * same reason `statutory-update.ts` sits beside it.
 *
 * ── WHY NO templateImport CAPABILITY ────────────────────────────────────────
 * The install and update routes carry it because they MINT a local template.
 * This one mints nothing; it stops offering what a workspace already has. A
 * workspace that deliberately revoked template import must still be able to take
 * a pack out of service — gating removal on the permission to add would leave it
 * holding something it cannot remove.
 *
 * ── WHY NO AUDIT EVENT ──────────────────────────────────────────────────────
 * Matching the install route, which writes none either. The service writes an
 * import-history row with `action: 'uninstall'`, which is where every other
 * marketplace event for this workspace is read from; a second, differently
 * shaped record of the same event is how the two come to disagree.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const uninstallRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/uninstall',
    tags: ['marketplace'],
    summary: 'Stop offering an installed catalogue entry',
    description:
        'Takes an installed pack out of service for this workspace. Nothing is deleted for a '
        + '1:1 kind: the local template is retired so it leaves the new-inspection picker, and '
        + 'inspections already using it keep producing from their own snapshot. A comment pack\'s '
        + 'imported rows ARE removed; comments the workspace wrote itself are never touched. '
        + 'Installing the entry again brings it back.',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: z.object({ id: z.string().trim().min(1).describe('The catalogue entry id') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean(),
                data: z.object({
                    kind: z.enum(['comments', 'templates', 'statutory']).describe('Which shape was un-imported'),
                    rowsAffected: z.number().int().describe('Local templates retired, or imported comment rows removed'),
                }),
            }) } },
            description: 'Un-installed',
        },
        400: { description: 'Not installed, or already uninstalled' },
        404: { description: 'No such catalogue entry' },
    },
    operationId: 'uninstallMarketplaceEntry',
}, { scopes: ['write'], tier: 'extended' }));

const marketplaceUninstallRoutes = createApiRouter()
    .openapi(uninstallRoute, async (c) => {
        const { id } = c.req.valid('param');
        const userId = (c.get('user')?.sub as string) || 'system';
        const result = await c.var.services.marketplace.uninstall(id, userId);
        return c.json({ success: true, data: result }, 200);
    });

export default marketplaceUninstallRoutes;
