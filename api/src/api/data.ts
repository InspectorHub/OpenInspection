import { OpenAPIHono } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { HonoConfig } from '../types/hono';
import { DataService } from '../services/data.service';
import { Errors } from '../lib/errors';

const dataRoutes = new OpenAPIHono<HonoConfig>();

// GET /api/data/export/inspections — CSV download
dataRoutes.get('/export/inspections', requireRole(['owner', 'admin']), async (c) => {
    const tenantId = c.get('tenantId');
    const svc = new DataService(c.env.DB);
    const csv = await svc.exportInspectionsCSV(tenantId);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
        headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="inspections-${date}.csv"`,
        },
    });
});

// GET /api/data/export/contacts — CSV download
dataRoutes.get('/export/contacts', requireRole(['owner', 'admin']), async (c) => {
    const tenantId = c.get('tenantId');
    const svc = new DataService(c.env.DB);
    const csv = await svc.exportContactsCSV(tenantId);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
        headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="contacts-${date}.csv"`,
        },
    });
});

// POST /api/data/import/contacts — multipart/form-data or text/csv body
// Query: ?dry_run=true — parse and count rows without writing to DB
dataRoutes.post('/import/contacts', requireRole(['owner', 'admin']), async (c) => {
    const tenantId = c.get('tenantId');
    const dryRun = c.req.query('dry_run') === 'true';
    const contentType = c.req.header('content-type') ?? '';
    let csvText = '';

    if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.formData();
        const file = formData.get('file');
        if (!file || typeof file === 'string') throw Errors.BadRequest('Expected a file upload named "file"');
        csvText = await (file as File).text();
    } else {
        csvText = await c.req.text();
    }

    if (!csvText.trim()) throw Errors.BadRequest('Empty CSV');
    if (csvText.length > 5 * 1024 * 1024) throw Errors.BadRequest('CSV too large (max 5MB)');

    const svc = new DataService(c.env.DB);
    const result = await svc.importContactsCSV(tenantId, csvText, { dryRun });
    return c.json({ success: true, data: result, dryRun }, 200);
});

export default dataRoutes;
