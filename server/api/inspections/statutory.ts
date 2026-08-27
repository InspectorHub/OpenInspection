/**
 * Serve the statutory form an inspection's template declares.
 *
 * -- WHY THIS IS ITS OWN FILE ------------------------------------------------
 * Not `evidence.ts`: those three helpers key off an agreement envelope, and
 * this one keys off an inspection and a template declaration. Not
 * `report-delivery.ts`: that file is already past 700 lines against a 400-line
 * ceiling, so adding a fourth deliverable there buys a refactor nobody asked
 * for. The headers are shared instead of the file being shared --
 * `lib/deliverable-headers.ts`.
 *
 * -- TWO PRECONDITIONS, AND NEITHER IS COSMETIC ------------------------------
 * 1. The inspection must have a PUBLISHED report version. A statutory form
 *    produced from still-editable content is a document nobody can reproduce:
 *    re-requesting it after another edit yields different bytes with the same
 *    name. It also leaves `x-artifact-status` with no produced-at to be true
 *    about, and a status header that cannot be wrong is a header with no
 *    content in it.
 * 2. The template snapshot must declare a form. Absent is the ordinary case for
 *    almost every template, so this is a 404 -- there is no such document for
 *    this inspection -- rather than an error.
 *
 * `producedAt` is the published version's own timestamp, never `Date.now()`.
 * Passing now would make the header read `current` forever, including for a
 * form whose report has since been corrected.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, desc } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { deliverableHeaders } from '../../lib/deliverable-headers';
import { produceStatutoryForm } from '../../services/statutory/produce.service';
import { PeopleService } from '../../services/people.service';
import { Errors } from '../../lib/errors';
import * as schema from '../../lib/db/schema';
import type { StatutoryFormDeclaration, TemplateSchemaV2 } from '../../types/template-schema';
import type { StatutoryInspectionFacts, StatutoryItemResult } from '../../lib/statutory/values';

const statutoryFormRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/statutory-form.pdf',
    tags: ['inspections'],
    summary: 'Download the statutory form this inspection produces',
    description:
        'Renders the authority\'s own published form for this inspection. 404 when the template '
        + 'declares none; 409 while no report version is published.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().trim().min(1).describe('Inspection ID') }) },
    responses: {
        200: { description: 'The rendered form' },
        404: { description: 'No such inspection for this workspace, or its template declares no form' },
        409: { description: 'No report version is published yet' },
    },
    operationId: 'getInspectionStatutoryForm',
}, { scopes: ['read'], tier: 'extended' }));

const statutoryRoutes = createApiRouter().openapi(statutoryFormRoute, async (c) => {
    const { id } = c.req.valid('param');
    // From the verified session. A tenant supplied by the caller would make
    // every id in the system reachable by guessing.
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB, { schema });

    const inspection = await db.select()
        .from(schema.inspections)
        .where(and(eq(schema.inspections.id, id), eq(schema.inspections.tenantId, tenantId)))
        .get();
    // Same answer for "does not exist" and "belongs to someone else": telling
    // the two apart is itself a disclosure.
    if (!inspection) throw Errors.NotFound('Inspection not found');

    const snapshot = inspection.templateSnapshot as (TemplateSchemaV2 & {
        statutoryForm?: StatutoryFormDeclaration;
    }) | null;
    const declaration = snapshot?.statutoryForm;
    if (!snapshot || !declaration) {
        throw Errors.NotFound('This inspection produces no statutory form');
    }

    const published = await db.select()
        .from(schema.reports)
        .where(and(
            eq(schema.reports.inspectionId, id),
            eq(schema.reports.tenantId, tenantId),
            eq(schema.reports.status, 'published'),
        ))
        .orderBy(desc(schema.reports.publishedAt))
        .get();
    if (!published?.publishedAt) {
        throw Errors.Conflict(
            'This inspection has no published report version yet. A statutory form produced from '
            + 'editable content could not be reproduced later.',
        );
    }

    const results = (await db.select()
        .from(schema.inspectionResults)
        .where(eq(schema.inspectionResults.inspectionId, id))
        .get())?.data as Record<string, StatutoryItemResult> | undefined;

    // The client comes from the inspection_people primary-client join, NOT from
    // inspections.client_name/_email/_phone -- those were a frozen cache and are
    // gone. A hard cutover with no legacy fallback, matching invoices,
    // agreements and publish elsewhere.
    const primaryClient = await new PeopleService({ DB: c.env.DB }).getPrimaryClient(tenantId, id);

    const facts: StatutoryInspectionFacts = {
        client_name: primaryClient?.name ?? null,
        client_email: primaryClient?.email ?? null,
        client_phone: primaryClient?.phone ?? null,
        property_address: inspection.propertyAddress ?? null,
        property_city: inspection.addressCity ?? null,
        property_state: inspection.addressState ?? null,
        property_zip: inspection.addressZip ?? null,
        inspection_date: inspection.date ?? null,
        inspector_name: null,
        inspector_license: null,
    };

    const produced = await produceStatutoryForm({
        formId: declaration.formId,
        inspectionDate: inspection.date,
        declaration,
        snapshot,
        results: results ?? {},
        facts,
        bucket: c.env.PHOTOS,
    });

    return new Response(produced.bytes, {
        status: 200,
        headers: await deliverableHeaders(
            c.env.DB, tenantId, id, published.publishedAt,
            'application/pdf',
            // Form and revision only. This string lands in download folders and
            // mail clients, so it carries no workspace or client identity.
            `inline; filename="${declaration.formId}-${produced.version.version.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`,
        ),
    });
});

export default statutoryRoutes;
