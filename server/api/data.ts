import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { DataService } from '../services/data.service';
import { capabilitiesFor } from '../lib/middleware/require-capability';

const dataRoutes = createApiRouter()
    // GET /api/data/export/inspections — CSV download
    .get('/export/inspections', requireRole('owner', 'manager'), async (c) => {
        const tenantId = c.get('tenantId');
        const svc = new DataService(c.env.DB);
        // A manager whose `financial` capability is switched off still exports the
        // inspections, without the price column.
        const csv = await svc.exportInspectionsCSV(tenantId, (await capabilitiesFor(c)).financial);
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
    })
    // GET /api/data/export/members — CSV download. Same role gate as the two
    // above: a roster names every colleague and what each of them may do, which
    // is not a list an inspector needs to be able to take away.
    .get('/export/members', requireRole('owner', 'manager'), async (c) => {
        const tenantId = c.get('tenantId');
        const svc = new DataService(c.env.DB);
        const csv = await svc.exportMembersCSV(tenantId);
        const date = new Date().toISOString().slice(0, 10);
        return new Response(csv, {
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="members-${date}.csv"`,
            },
        });
    });

export type DataApi = typeof dataRoutes;
export default dataRoutes;
