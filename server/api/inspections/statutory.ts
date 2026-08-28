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
import {
    StatutoryOverflowService,
    refuseIndexInsidePrintedRange,
} from '../../services/statutory/overflow.service';
import { versionForInspection } from '../../lib/statutory/form-registry';
import { PUBLISHED_FORM_VERSIONS } from '../../lib/statutory/forms';
import { utcMidnightOf } from '../../lib/statutory/inspection-date';
import { statutoryNoticeFor, formatEffectiveDate } from '../../lib/statutory/disclaimer';
import { PeopleService } from '../../services/people.service';
import { CredentialService } from '../../services/credential.service';
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

/**
 * The offer route, read by the inspection hub loader.
 *
 * It exists so the UI can ask "is there a statutory form here, and what does
 * the notice say" WITHOUT downloading one. The notice is rendered server-side
 * from `lib/statutory/disclaimer.ts`, which is what keeps that module on a
 * production path -- a notice composed in the component instead would be
 * invisible to the copy gate and the non-translatable registry, and the
 * unwired census would be right to call the module unreachable.
 *
 * `available: false` is a normal answer, not an error. A deployment that
 * publishes no forms answers it for every inspection, which is why the control
 * simply does not render rather than rendering and then failing.
 */
const statutoryOfferRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/statutory-form',
    tags: ['inspections'],
    summary: 'Whether this inspection produces a statutory form, and its notice',
    description: 'Answers without rendering a PDF. available:false is the ordinary answer.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().trim().min(1).describe('Inspection ID') }) },
    responses: {
        200: { description: 'The offer, available or not' },
        404: { description: 'No such inspection for this workspace' },
    },
    operationId: 'getInspectionStatutoryFormOffer',
}, { scopes: ['read'], tier: 'extended' }));


/**
 * POST /api/inspections/:id/statutory-form/instances
 *
 * Record one repeated-block instance the authority's page has no slot to print.
 *
 * Printed slots do NOT come through here: they are ordinary template items and
 * their values reach the form as bindings. This is only for what the item model
 * cannot express, which is why an index inside the printed range is refused
 * rather than accepted and quietly ignored.
 */
const AddInstanceBodySchema = z.object({
    groupId: z.string().trim().min(1).describe('The repeated block, e.g. electrical_panel'),
    index: z.number().int().min(0).describe('Position, 0-based. Must be at or past the group capacity.'),
    fields: z.record(z.string(), z.string()).describe('Field name to value, in the vocabulary the group declares'),
});

const addInstanceRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/statutory-form/instances',
    tags: ['inspections'],
    summary: 'Record an instance the statutory form has no slot for',
    description: 'Stores one repeated-block instance past the printed capacity of the form. '
        + 'Printed slots are ordinary items and are not recorded here.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection ID') }),
        body: { content: { 'application/json': { schema: AddInstanceBodySchema } } },
    },
    responses: {
        200: { description: 'Recorded' },
        400: { description: 'The index names a slot the form prints' },
        404: { description: 'No such inspection, or it produces no statutory form' },
    },
    operationId: 'addInspectionStatutoryFormInstance',
}, { scopes: ['write'], tier: 'extended' }));

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

    // The inspector's name comes from `users` and the licence from the credential
    // rows, exactly as the report PDF's signature block resolves them -- one
    // source, so the two surfaces can never disagree about the same inspector.
    //
    // NOTE ON NULL: CredentialService returns null when there is no credential,
    // and its own callers OMIT the line rather than print an empty one. That is
    // right for a report footer and wrong here. On an authority's form the box is
    // preprinted, so a blank is not "no such item" -- it is an invalid submission.
    // A null therefore reaches collectStatutoryValues and is refused there by the
    // required-field check, which is the intended behaviour.
    const inspectorId = inspection.inspectorId;
    const inspectorRow = inspectorId
        ? await db.select({ name: schema.users.name })
            .from(schema.users)
            .where(and(eq(schema.users.id, inspectorId), eq(schema.users.tenantId, tenantId)))
            .get()
        : undefined;
    const licenceNumber = inspectorId
        ? await new CredentialService(c.env.DB).primaryLicenseNumber(tenantId, inspectorId)
        : null;

    // The company identity is the workspace config, read the same way the
    // publish path reads its branding.
    const config = await db.select({
        companyName: schema.tenantConfigs.companyName,
        companyPhone: schema.tenantConfigs.companyPhone,
    })
        .from(schema.tenantConfigs)
        .where(eq(schema.tenantConfigs.tenantId, tenantId))
        .get();

    const facts: StatutoryInspectionFacts = {
        client_name: primaryClient?.name ?? null,
        client_email: primaryClient?.email ?? null,
        client_phone: primaryClient?.phone ?? null,
        property_address: inspection.propertyAddress ?? null,
        property_city: inspection.addressCity ?? null,
        property_state: inspection.addressState ?? null,
        property_zip: inspection.addressZip ?? null,
        inspection_date: inspection.date ?? null,
        inspector_name: inspectorRow?.name ?? null,
        inspector_license: licenceNumber,
        company_name: config?.companyName ?? null,
        company_phone: config?.companyPhone ?? null,
    };

    // Instances the page has no slot to print. Printed slots are ordinary items
    // and arrive through the bindings above; these are what the item model has
    // nowhere to put, and without them a third panel would simply not exist as
    // far as the form is concerned.
    const instances = await new StatutoryOverflowService(db)
        .instancesFor(tenantId, id, declaration.formId);

    const produced = await produceStatutoryForm({
        formId: declaration.formId,
        inspectionDate: inspection.date,
        declaration,
        snapshot,
        results: results ?? {},
        facts,
        instances,
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
})
    .openapi(statutoryOfferRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB, { schema });

        const inspection = await db.select()
            .from(schema.inspections)
            .where(and(eq(schema.inspections.id, id), eq(schema.inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const snapshot = inspection.templateSnapshot as (TemplateSchemaV2 & {
            statutoryForm?: StatutoryFormDeclaration;
        }) | null;
        const declaration = snapshot?.statutoryForm;
        const unavailable = { success: true, data: { available: false } } as const;
        if (!declaration) return c.json(unavailable, 200);

        const published = await db.select()
            .from(schema.reports)
            .where(and(
                eq(schema.reports.inspectionId, id),
                eq(schema.reports.tenantId, tenantId),
                eq(schema.reports.status, 'published'),
            ))
            .orderBy(desc(schema.reports.publishedAt))
            .get();
        if (!published?.publishedAt) return c.json(unavailable, 200);

        // Same selection the PDF route makes, so the two can never disagree
        // about which revision this inspection is governed by.
        const version = versionForInspection(
            declaration.formId, utcMidnightOf(inspection.date), PUBLISHED_FORM_VERSIONS,
        );
        if (!version) return c.json(unavailable, 200);

        return c.json({
            success: true,
            data: {
                available: true,
                formId: version.formId,
                revision: version.version,
                effectiveDate: formatEffectiveDate(version.effectiveFrom),
                notice: statutoryNoticeFor(version, { softwareName: c.env.APP_NAME || 'This software' }),
            },
        }, 200);
    })

    .openapi(addInstanceRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { groupId, index, fields } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB, { schema });

        const inspection = await db.select()
            .from(schema.inspections)
            .where(and(eq(schema.inspections.id, id), eq(schema.inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const declaration = (inspection.templateSnapshot as {
            statutoryForm?: StatutoryFormDeclaration;
        } | null)?.statutoryForm;
        if (!declaration) throw Errors.NotFound('This inspection produces no statutory form');

        const group = declaration.groups?.find((g) => g.id === groupId);
        if (!group) throw Errors.NotFound(`This form declares no group "${groupId}"`);

        // A printed slot's value comes from a binding, which is its authority.
        // Accepting a second writer would give one box two sources with nothing
        // to say which the form carried.
        try {
            refuseIndexInsidePrintedRange(group, index);
        } catch (cause) {
            throw Errors.BadRequest((cause as Error).message);
        }

        await new StatutoryOverflowService(db)
            .addInstance(tenantId, id, declaration.formId, groupId, index, fields);
        return c.json({ success: true, data: { recorded: true } }, 200);
    });

export default statutoryRoutes;
