/**
 * Read and write the inspection-level answers an authority's form asks for.
 *
 * -- WHY NOT IN `statutory.ts` ----------------------------------------------
 * That file is 399 lines against a 400-line ceiling, and it answers a different
 * question: whether a form may be produced and what bytes come out. This one is
 * data entry. Splitting on that line was better than raising a baseline.
 *
 * -- WHY THERE IS NO 404 FOR "THIS TEMPLATE DECLARES NO FORM" ----------------
 * There deliberately is one. The panel these fields belong to is rendered only
 * where the template declares a statutory form, so a write arriving for any
 * other inspection is a client that has lost track of what it is editing —
 * accepting it would store an owner's phone number on a house nobody will ever
 * produce a form for, which is personal data collected for no purpose.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { StatutoryDetailsService } from '../../services/statutory/details.service';
import { Errors } from '../../lib/errors';
import * as schema from '../../lib/db/schema';
import type { StatutoryFormDeclaration } from '../../types/template-schema';

/**
 * Every field optional and nullable, and NO `.default()` anywhere.
 *
 * A `.default()` survives `.partial()` in zod, so a PATCH that named one field
 * would arrive at the service with the other seven defaulted and silently
 * overwrite them. The service reads the ABSENCE of a key as "leave it alone",
 * which only works while absence can actually reach it.
 */
const DetailsBodySchema = z.object({
    inspectorSignatureDate: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/,
        'a signing date is a YYYY-MM-DD calendar day')
        .nullable().optional()
        .describe('The day the inspector signed — NOT the day of the visit. Empty clears it.'),
    employeePrintedName: z.string().trim().max(120).nullable().optional()
        .describe('The second signer FL OIR-B1-1802 page 5 prints. Empty clears it.'),
    ownerName: z.string().trim().max(120).nullable().optional()
        .describe('The property OWNER, who is frequently not the client. Empty clears it.'),
    ownerEmail: z.string().trim().max(200).nullable().optional()
        .describe('The owner\'s email. Empty clears it.'),
    ownerMailingAddress: z.string().trim().max(300).nullable().optional()
        .describe('Where the owner receives post, which may not be the property. Empty clears it.'),
    ownerHomePhone: z.string().trim().max(40).nullable().optional()
        .describe('The owner\'s home number. The form prints three separate boxes.'),
    ownerWorkPhone: z.string().trim().max(40).nullable().optional()
        .describe('The owner\'s work number.'),
    ownerCellPhone: z.string().trim().max(40).nullable().optional()
        .describe('The owner\'s mobile number.'),
});

const readRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/statutory-details',
    tags: ['inspections'],
    summary: 'The inspection-level answers this inspection\'s statutory form asks for',
    description: 'Every field is null until somebody fills it in; null is a normal answer.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().trim().min(1).describe('Inspection ID') }) },
    responses: {
        200: { description: 'What has been recorded' },
        404: { description: 'No such inspection, or its template declares no statutory form' },
    },
    operationId: 'getInspectionStatutoryDetails',
}, { scopes: ['read'], tier: 'extended' }));

const writeRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}/statutory-details',
    tags: ['inspections'],
    summary: 'Record the inspection-level answers a statutory form asks for',
    description: 'A field left out is left alone; a field sent empty is cleared.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection ID') }),
        body: { content: { 'application/json': { schema: DetailsBodySchema } } },
    },
    responses: {
        200: { description: 'Recorded, and the whole record comes back' },
        404: { description: 'No such inspection, or its template declares no statutory form' },
    },
    operationId: 'updateInspectionStatutoryDetails',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * The inspection exists, belongs to this workspace, and produces a form.
 *
 * The same answer for "no such inspection" and "somebody else's": telling the
 * two apart is itself a disclosure.
 */
async function requireStatutoryInspection(
    db: ReturnType<typeof drizzle<typeof schema>>,
    tenantId: string,
    id: string,
): Promise<void> {
    const inspection = await db.select({ snapshot: schema.inspections.templateSnapshot })
        .from(schema.inspections)
        .where(and(eq(schema.inspections.id, id), eq(schema.inspections.tenantId, tenantId)))
        .get();
    if (!inspection) throw Errors.NotFound('Inspection not found');
    const declaration = (inspection.snapshot as {
        statutoryForm?: StatutoryFormDeclaration;
    } | null)?.statutoryForm;
    if (!declaration) throw Errors.NotFound('This inspection produces no statutory form');
}

const statutoryDetailsRoutes = createApiRouter()
    .openapi(readRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB, { schema });
        await requireStatutoryInspection(db, tenantId, id);
        const details = await new StatutoryDetailsService(db).get(tenantId, id);
        return c.json({ success: true, data: details }, 200);
    })

    .openapi(writeRoute, async (c) => {
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB, { schema });
        await requireStatutoryInspection(db, tenantId, id);
        const details = await new StatutoryDetailsService(db)
            .save(tenantId, id, patch, Date.now());
        return c.json({ success: true, data: details }, 200);
    });

export default statutoryDetailsRoutes;
