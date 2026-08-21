import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { DataService } from '../services/data.service';

const dataRoutes = createApiRouter()
    // GET /api/data/export/inspections — CSV download
    .get('/export/inspections', requireRole('owner', 'manager'), async (c) => {
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
    })
    // GET /api/data/export/contacts — CSV download
    .get('/export/contacts', requireRole('owner', 'manager'), async (c) => {
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

export type DataApi = typeof dataRoutes;
export default dataRoutes;
