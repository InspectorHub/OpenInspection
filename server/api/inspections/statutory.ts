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
 * 3. The revision this template produces must be the revision this inspection's
 *    own date selects. A mismatch is the one state the design blocks, and it is
 *    blocked HERE rather than only in the editor's banner: producing anyway
 *    would put the governing revision's bytes under the superseded revision's
 *    bindings, and where two revisions' field names overlap that is a plausible,
 *    WRONG official document which `recordProduction` then files as legitimate.
 *    The judgement is `revisionStatusForInspection` -- the same call the banner,
 *    the reschedule response and the update confirmation make, because a warning
 *    and a refusal that each decided for themselves would disagree at some date
 *    boundary, and the disagreement would be silent.
 *
 * 4. The revision must not have been WITHDRAWN. Checked ahead of 3, because a
 *    withdrawal is the only fault here that has already put wrong documents in
 *    somebody's hands, and the refusal names WHY it was withdrawn: this
 *    software's field map was found wrong, in which case a correction is coming
 *    from us and what already went out should go out again, or the authority
 *    retired the document, in which case nothing is coming and the reader moves
 *    to the revision now in force. The two sentences live in
 *    `lib/statutory/withdrawal-copy.ts`, not here.
 *
 * There is deliberately NO migration out of that state (see revision-status.ts).
 * The way out is a new inspection on the updated template, and the earlier
 * warnings exist so nobody arrives here.
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
import { recordProduction } from '../../services/statutory/production-record';
import {
    StatutoryOverflowService,
    refuseIndexInsidePrintedRange,
} from '../../services/statutory/overflow.service';
import { versionForInspection } from '../../lib/statutory/form-registry';
import { revisionStatusForInspection } from '../../lib/statutory/revision-status';
import { withdrawalRefusal } from '../../lib/statutory/withdrawal-copy';
import { PUBLISHED_FORM_VERSIONS } from '../../lib/statutory/forms';
import { utcMidnightOf, calendarDayOfStoredDate } from '../../lib/statutory/inspection-date';
import { statutoryNoticeFor, formatEffectiveDate } from '../../lib/statutory/disclaimer';
import { Errors } from '../../lib/errors';
import * as schema from '../../lib/db/schema';
import type { StatutoryFormDeclaration, TemplateSchemaV2 } from '../../types/template-schema';
import { gatherStatutoryInputs } from './statutory-inputs';
import { logger } from '../../lib/logger';

const statutoryFormRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/statutory-form.pdf',
    tags: ['inspections'],
    summary: 'Download the statutory form this inspection produces',
    description:
        'Renders the authority\'s own published form for this inspection. 404 when the template '
        + 'declares none; 409 while no report version is published, and 409 when the inspection\'s '
        + 'date is governed by a revision this template does not produce.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().trim().min(1).describe('Inspection ID') }) },
    responses: {
        200: { description: 'The rendered form' },
        404: { description: 'No such inspection for this workspace, or its template declares no form' },
        409: { description: 'No report version is published yet, or the governing revision is not the one this template produces' },
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

    // Precondition 3. Refused before anything is rendered and before anything is
    // recorded: a refusal after the bytes exist is a document that was produced.
    //
    // `null` and the three non-blocking states pass. In particular a template
    // that names no revision is NOT refused -- it makes no claim to measure, and
    // guessing one would refuse a correct report. The blocking state is the only
    // one where the template's own claim contradicts the inspection's date.
    // ONE reading of the column, handed to everything below: `inspections.date`
    // holds a calendar day OR that day plus an instant (`calendarDayOfStoredDate`),
    // and everything past this line takes a bare day. The hand-rolled slice that
    // used to sit here narrowed the revision check while the RAW value still went
    // on to the producer -- which is how every wizard-made inspection 500ed.
    const inspectionDay = calendarDayOfStoredDate(inspection.date);
    const revision = revisionStatusForInspection({
        snapshot,
        inspectionDate: inspectionDay,
        now: Date.now(),
    });
    if (revision?.kind === 'withdrawn') {
        // Checked before `cannot_produce`, in the same order the criterion
        // itself decides them: a withdrawal is the only fault here that has
        // already put wrong documents into somebody's hands, and its remedy
        // depends on WHY. Refusing with the generic "different document"
        // sentence would be true and useless.
        throw Errors.Conflict(withdrawalRefusal({
            formId: declaration.formId,
            version: revision.version,
            reason: revision.reason,
            at: revision.withdrawnAt,
            replacementVersion: revision.replacementVersion,
            inspectionDate: inspectionDay,
        }));
    }
    if (revision?.kind === 'cannot_produce') {
        throw Errors.Conflict(
            `This inspection is dated ${inspectionDay}, which revision `
            + `${revision.applicableVersion} of ${declaration.formId} governs. This template `
            + `produces revision ${revision.templateVersion}, so its bindings were written `
            + 'against a different document and cannot be printed onto this one. There is no '
            + 'migration for an inspection already under way: once the workspace has updated its '
            + `copy of the template, reopen this inspection on the ${revision.applicableVersion} `
            + 'template.',
        );
    }

    const { results, facts, skippedNonDefaultUnits } = await gatherStatutoryInputs(
        db, c.env.DB, tenantId, inspection, inspectionDay,
    );
    if (skippedNonDefaultUnits.length > 0) {
        // Answered only under some other unit. This form describes one dwelling,
        // so substituting a unit's answer would print its findings under the
        // whole building's address.
        logger.warn('statutory: item answered only outside the default unit', {
            inspectionId: id,
            items: skippedNonDefaultUnits.slice(0, 10),
            count: skippedNonDefaultUnits.length,
        });
    }

    // Instances the page has no slot to print. Printed slots are ordinary items
    // and arrive through the bindings above; these are what the item model has
    // nowhere to put, and without them a third panel would simply not exist as
    // far as the form is concerned.
    const instances = await new StatutoryOverflowService(db)
        .instancesFor(tenantId, id, declaration.formId);

    const produced = await produceStatutoryForm({
        formId: declaration.formId,
        inspectionDate: inspectionDay,
        declaration,
        snapshot,
        results: results ?? {},
        facts,
        instances,
        bucket: c.env.PHOTOS,
    });

    // Which revision this document was produced from. Written before the bytes
    // are handed over, because a recall counts documents that LEFT and a row
    // written after the response would be missing exactly the deliveries that
    // failed on the way out.
    await recordProduction(db, {
        tenantId,
        inspectionId: id,
        formId: declaration.formId,
        version: produced.version.version,
        sourceHash: produced.version.sourceHash,
        producedBy: c.get('user')?.sub ?? 'unknown',
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

        // Same reading of the column the PDF route makes, so the two can never
        // disagree about which day -- and so which revision -- governs. A date
        // this cannot read is a FAULT, not the ordinary absence, but the answer
        // still has to be `available: false` so the page renders. So it says WHY
        // on the way out: a silent degrade is how this survived the whole
        // published life of the TREC form, the control simply never appearing.
        let inspectionDay: string;
        try {
            inspectionDay = calendarDayOfStoredDate(inspection.date);
        } catch (cause) {
            logger.warn('statutory: offer withheld, the inspection date is unreadable', {
                inspectionId: id,
                formId: declaration.formId,
                reason: cause instanceof Error ? cause.message : String(cause),
            });
            return c.json(unavailable, 200);
        }

        const version = versionForInspection(
            declaration.formId, utcMidnightOf(inspectionDay), PUBLISHED_FORM_VERSIONS,
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
