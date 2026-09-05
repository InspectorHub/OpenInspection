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
 * There is deliberately NO migration out of that state (see revision-status.ts):
 * the way out is a new inspection on the updated template. Every OTHER refusal
 * on this path -- the producer's and the renderer's -- reaches the reader
 * through `refusalToUser`; see that file for why it had to be added.
 *
 * `producedAt` is the published version's own timestamp, never `Date.now()`.
 * Passing now would make the header read `current` forever, including for a
 * form whose report has since been corrected.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, desc } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { deliverableHeaders } from '../../lib/deliverable-headers';
import { produceStatutoryForm } from '../../services/statutory/produce.service';
import { recordProduction } from '../../services/statutory/production-record';
import {
    StatutoryOverflowService,
    refuseIndexInsidePrintedRange,
} from '../../services/statutory/overflow.service';
import { versionForInspection } from '../../lib/statutory/form-registry';
import { PUBLISHED_FORM_VERSIONS } from '../../lib/statutory/forms';
import { utcMidnightOf, calendarDayOfStoredDate } from '../../lib/statutory/inspection-date';
import { statutoryNoticeFor, formatEffectiveDate } from '../../lib/statutory/disclaimer';
import { Errors } from '../../lib/errors';
import { refusalToUser } from '../../lib/statutory/refusal-to-user';
import * as schema from '../../lib/db/schema';
import type { StatutoryFormDeclaration, TemplateSchemaV2 } from '../../types/template-schema';
import { resolveProducibleStatutoryForm } from '../../services/statutory/producible';
import { watermarkAsPreview } from '../../lib/statutory/preview-watermark';
import { logger } from '../../lib/logger';
import {
    statutoryFormRoute,
    statutoryPreviewRoute,
    statutoryOfferRoute,
    addInstanceRoute,
} from './statutory.routes';

const statutoryRoutes = createApiRouter().openapi(statutoryFormRoute, async (c) => {
    const { id } = c.req.valid('param');
    // From the verified session. A tenant supplied by the caller would make
    // every id in the system reachable by guessing.
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB, { schema });

    // Preconditions 2, 3 and 4 and every input, resolved by the same function
    // the editor's preview calls. They decide WHICH DOCUMENT comes out, so a
    // second copy of them would be a second opinion about the one thing this
    // subsystem exists to keep single.
    const { snapshot, declaration, inspectionDay, inputs, instances } =
        await resolveProducibleStatutoryForm(db, c.env.DB, tenantId, id);

    // Precondition 1, and it stays HERE rather than moving with the others: it
    // is not about which document comes out, it is about reproducing the one
    // that was handed over. A preview is never handed over, so it does not
    // apply there -- see `statutory-preview.ts`.
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
            + 'editable content could not be reproduced later. To check the form before then, '
            + 'open the preview in the editor -- it renders the same document, watermarked, and '
            + 'files nothing.',
        );
    }
    const { results, facts, signatures } = inputs;

    const produced = await refusalToUser(() => produceStatutoryForm({
        formId: declaration.formId,
        inspectionDate: inspectionDay,
        declaration,
        snapshot,
        results: results ?? {},
        facts,
        instances,
        signatures,
        bucket: c.env.PHOTOS,
    }));

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
    /**
     * The preview. Same document, no published report required, nothing filed.
     *
     * Everything that decides WHICH document comes out is resolved by the same
     * function the deliverable calls, so the two cannot drift apart on a
     * revision boundary and show an inspector a form the download will refuse.
     * What differs is exactly two things, and both are visible right here
     * rather than behind a flag: `recordProduction` is not called, and the
     * bytes are stamped before they leave.
     */
    .openapi(statutoryPreviewRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB, { schema });

        const { snapshot, declaration, inspectionDay, inputs, instances } =
            await resolveProducibleStatutoryForm(db, c.env.DB, tenantId, id);

        const produced = await refusalToUser(() => produceStatutoryForm({
            formId: declaration.formId,
            inspectionDate: inspectionDay,
            declaration,
            snapshot,
            results: inputs.results ?? {},
            facts: inputs.facts,
            instances,
            signatures: inputs.signatures,
            bucket: c.env.PHOTOS,
        }));

        // NOTHING IS RECORDED HERE, ON PURPOSE. `recordProduction` exists so a
        // recall can count the documents that LEFT; a preview never leaves, and
        // a row claiming it did would make a recall chase a document nobody
        // has. The absence is the feature -- see the route's own note.
        const watermarked = await watermarkAsPreview(produced.bytes);

        return new Response(watermarked, {
            status: 200,
            headers: {
                'content-type': 'application/pdf',
                // Inline: this is meant to be LOOKED at, in the editor, not
                // saved. A download would put an unpublishable copy of
                // still-changing work into somebody's downloads folder, which
                // is the one place the watermark has to survive on its own.
                'content-disposition': 'inline',
                // Never cached. The whole point is that it reflects the
                // inspection as it stands right now; a cached preview would
                // answer a question about a version the inspector has already
                // moved past, and look authoritative doing it.
                'cache-control': 'no-store',
                // No `deliverableHeaders`: those carry `x-artifact-status` and a
                // produced-at drawn from the published version, and there is no
                // published version here to be true about.
            },
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
                // The TITLE, not `formId`. What the offer hands the UI is what
                // the UI prints, and `formId` is a key rather than a name.
                formTitle: version.formTitle,
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
