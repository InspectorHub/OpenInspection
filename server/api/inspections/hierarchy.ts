// Units tree, observer links, and report versions sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies are
// byte-identical to the original (only the dynamic-import path depth changed).
import {
    Errors,
    createApiRouter,
    createUnitRoute,
    deleteUnitRoute,
    diffVersionRoute,
    getVersionRoute,
    listObserverLinksRoute,
    listUnitsRoute,
    listVersionsRoute,
    mintObserverLinkRoute,
    moveUnitRoute,
    revokeObserverLinkRoute,
    updateUnitRoute,
} from './_shared';

const hierarchyRoutes = createApiRouter()
    .openapi(createUnitRoute, async (c) => {
        const { id }      = c.req.valid('param');
        const input       = c.req.valid('json');
        const tenantId    = c.get('tenantId');
        try {
            const out = await c.var.services.unit.create(tenantId, { inspectionId: id, ...input });
            return c.json({ success: true as const, data: out }, 200);
        } catch (err) {
            throw Errors.BadRequest((err as Error).message);
        }
    })
    .openapi(listUnitsRoute, async (c) => {
        const { id }   = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const units    = await c.var.services.unit.list(tenantId, id);
        return c.json({ success: true as const, data: { units } }, 200);
    })
    .openapi(updateUnitRoute, async (c) => {
        const { unitId } = c.req.valid('param');
        const patch      = c.req.valid('json');
        await c.var.services.unit.update(c.get('tenantId'), unitId, patch);
        return c.json({ success: true as const }, 200);
    })
    .openapi(deleteUnitRoute, async (c) => {
        const { unitId } = c.req.valid('param');
        await c.var.services.unit.delete(c.get('tenantId'), unitId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(moveUnitRoute, async (c) => {
        const { unitId } = c.req.valid('param');
        const { newParentUnitId, newSortOrder } = c.req.valid('json');
        try {
            await c.var.services.unit.move(c.get('tenantId'), unitId, newParentUnitId, newSortOrder);
            return c.json({ success: true as const }, 200);
        } catch (err) {
            throw Errors.BadRequest((err as Error).message);
        }
    })
    .openapi(mintObserverLinkRoute, async (c) => {
        const { id }   = c.req.valid('param');
        const { durationSeconds } = c.req.valid('json');
        const createdBy = (c.get('user') as { sub?: string } | undefined)?.sub;
        if (!createdBy) throw Errors.Unauthorized('Missing user identity');

        const out = await c.var.services.observerLink.mint(c.get('tenantId'), {
            inspectionId: id,
            createdBy,
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        });

        // Augment the bare service output with a fully-qualified claim URL
        // so the InspectorToolsDock modal can render a copy-and-paste field
        // without re-deriving the host or token path on the client.
        const baseUrl = c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`;
        const url     = `${baseUrl}/observe/${out.token}`;
        return c.json({ success: true as const, data: { ...out, url } }, 200);
    })
    .openapi(listObserverLinksRoute, async (c) => {
        const { id } = c.req.valid('param');
        const links  = await c.var.services.observerLink.list(c.get('tenantId'), id);
        return c.json({ success: true as const, data: { links } }, 200);
    })
    .openapi(revokeObserverLinkRoute, async (c) => {
        const { linkId } = c.req.valid('param');
        await c.var.services.observerLink.revoke(c.get('tenantId'), linkId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(listVersionsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const versions = await c.var.services.reportVersion.list(c.get('tenantId'), id);
        return c.json({ success: true as const, data: { versions } }, 200);
    })
    .openapi(getVersionRoute, async (c) => {
        const { id, n } = c.req.valid('param');
        const snap = await c.var.services.reportVersion.get(c.get('tenantId'), id, parseInt(n, 10));
        if (!snap) throw Errors.NotFound('Version not found');
        return c.json({ success: true as const, data: snap }, 200);
    })
    .openapi(diffVersionRoute, async (c) => {
        const { id, n } = c.req.valid('param');
        const { from }  = c.req.valid('query');
        const diff = await c.var.services.reportVersion.diff(
            c.get('tenantId'), id, parseInt(from, 10), parseInt(n, 10),
        );
        if (!diff) throw Errors.NotFound('Version diff not available');
        return c.json({ success: true as const, data: diff }, 200);
    })
    // Typed-Hono dead-routes cleanup Task 10 — vectorised result patches.;

export default hierarchyRoutes;
