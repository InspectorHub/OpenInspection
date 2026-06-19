// Template CRUD, duplicates, and Spectora import sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies are
// byte-identical to the original (only the dynamic-import path depth changed).
import {
    auditFromContext,
    buildMeta,
    createApiRouter,
    createTemplateRoute,
    deleteTemplateRoute,
    getTemplateRoute,
    importSpectoraRoute,
    listTemplateDuplicatesRoute,
    listTemplatesRoute,
    updateTemplateRoute,
} from './_shared';

const templatesRoutes = createApiRouter()
    .openapi(listTemplatesRoute, async (c) => {
        const queryParams = c.req.valid('query');
        const service = c.var.services.template;
        const { page, pageSize, q } = queryParams;
        const { rows, total } = await service.listTemplates(c.get('tenantId'), {
            ...(page !== undefined ? { page } : {}),
            ...(pageSize !== undefined ? { pageSize } : {}),
            ...(q !== undefined ? { q } : {}),
        });
        return c.json({
            success: true,
            data: rows,
            meta: buildMeta({ total, page: queryParams.page, pageSize: queryParams.pageSize }),
        }, 200);
    })
    .openapi(listTemplateDuplicatesRoute, async (c) => {
        const service = c.var.services.template;
        const dups = await service.findDuplicates(c.get('tenantId'));
        return c.json({ success: true, data: dups }, 200);
    })
    .openapi(getTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.template;
        const template = await service.getTemplate(id, c.get('tenantId'));
        return c.json({ success: true, data: { template } }, 200);
    })
    .openapi(createTemplateRoute, async (c) => {
        const body = c.req.valid('json');
        const service = c.var.services.template;
        const template = await service.createTemplate(c.get('tenantId'), body.name, body.schema);
        auditFromContext(c, 'template.create', 'template', {
            entityId: template.id,
            metadata: { name: template.name },
        });
        return c.json({ success: true, data: { template } }, 201);
    })
    .openapi(importSpectoraRoute, async (c) => {
        const body = c.req.valid('json');
        const { convertSpectoraTemplate } = await import('../../lib/spectora-import');
        const { template: schema, stats } = convertSpectoraTemplate(body.spectora as Parameters<typeof convertSpectoraTemplate>[0]);
        // createTemplate accepts a plain Record<string, unknown> schema; the
        // converter's TemplateSchemaV2 interface is structurally compatible,
        // so cast it through unknown to placate the strict index signature
        // requirement on the service entry-point.
        const template = await c.var.services.template.createTemplate(
            c.get('tenantId'),
            body.name,
            schema as unknown as Record<string, unknown>,
        );
        auditFromContext(c, 'template.create', 'template', {
            entityId: template.id,
            metadata: { name: template.name, source: 'spectora-import' },
        });
        return c.json({ success: true, data: { template, stats } }, 201);
    })
    .openapi(updateTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const service = c.var.services.template;
        const template = await service.updateTemplate(id, c.get('tenantId'), body.name, body.schema);
        auditFromContext(c, 'template.update', 'template', {
            entityId: id,
            metadata: { name: template.name },
        });
        return c.json({ success: true, data: { template } }, 200);
    })
    .openapi(deleteTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.template;
        await service.deleteTemplate(id, c.get('tenantId'));
        auditFromContext(c, 'template.delete', 'template', { entityId: id });
        return c.json({ success: true }, 200);
    });

export default templatesRoutes;
