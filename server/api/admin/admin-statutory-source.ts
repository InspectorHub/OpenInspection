// Admin → the authority's own PDF for one published revision.
//
// A statutory form is rendered onto the issuing agency's document, and that
// document is not carried in this repository: it is the agency's, and a field
// map is authored against one revision's exact bytes. Nothing wrote those bytes
// to storage, so a deployment could install a statutory package and then fail to
// produce anything from it -- "installed" and "usable" quietly meaning different
// things, which is among the hardest classes of fault to trace.
//
// This is that missing step, and it is a person's step. See
// services/statutory/source-upload.ts for why the bytes are not fetched on the
// operator's behalf.
//
// ── WHY THE REVISION TRAVELS IN THE BODY, NOT THE PATH ──────────────────────
// Revision labels are the authority's own, verbatim, and they contain slashes
// (`Rev. 04/26`). A percent-encoded slash in a path segment is normalised by
// intermediaries and by more than one router, so the label would arrive split or
// mangled exactly for the forms most likely to need it. It is a form field.
//
// ── WHY `owner` AND NOT A PLATFORM GUARD ────────────────────────────────────
// In a self-hosted deployment the operator IS the workspace owner, and there is
// no platform to ask. Widening the shared `_platform/` key to a workspace role
// is safe here specifically because of the hash: the recorded sha256 admits
// exactly one sequence of bytes, so the most a caller can do is write the
// authority's real document over itself. Nothing else about this key is
// writable from a workspace, and the cross-tenant admin reads (who is on which
// revision, what a withdrawal affects) deliberately live elsewhere, behind the
// M2M guard -- see server/portal/statutory-admin.routes.ts.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { Errors } from '../../lib/errors';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import { logger } from '../../lib/logger';
import { statutoryReadiness } from '../../services/statutory/readiness';
import { PUBLISHED_FORM_VERSIONS } from '../../lib/statutory/forms';
import { listStatutoryFormSources, storeStatutoryFormSource } from '../../services/statutory/source-upload';

/**
 * What an operator has to see BEFORE they can upload anything.
 *
 * The upload below takes a revision label the caller already knows. Nobody
 * knows one: the labels are the authority's own, they contain characters a URL
 * mangles, and which of them this build publishes is decided by what is
 * compiled in. Without this read the only way to reach the upload was to open
 * the source and copy a string out of it, which is not a product.
 *
 * It answers presence too, because "which revisions exist" and "which of them
 * can actually render" are the same question asked one step apart, and a screen
 * that had to join two responses to show one row would be a screen that shows
 * the join wrong on the day one call fails.
 */
const listSourcesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/statutory-forms',
    tags: ['admin'],
    summary: 'Published statutory revisions, and whether their PDFs are stored',
    middleware: [requireRole('owner')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        storageBound: z.boolean().describe('Whether this deployment has object storage bound at all. False means no upload can ever succeed here, which is a different problem from an absent file.'),
                        revisions: z.array(z.object({
                            formId: z.string().describe('Stable id of the statutory form itself, e.g. tx_trec_rei.'),
                            formTitle: z.string().describe("The form's own published name, as the issuing authority writes it. Present because formId is a database key and cannot be checked against the authority's site."),
                            revision: z.string().describe("The authority's own revision label, verbatim."),
                            sourceHash: z.string().describe('sha256 an upload for this revision is checked against, lowercase hex.'),
                            sourceUrl: z.string().describe('Where the authority publishes this revision. Provenance for a human; nothing is fetched from it.'),
                            effectiveFrom: z.number().describe('First date this revision may be used, epoch ms.'),
                            mandatoryFrom: z.number().nullable().describe('First date this revision is required, epoch ms, or null if it was never mandated.'),
                            effectiveUntil: z.number().nullable().describe('First date this revision may no longer be used, epoch ms, exclusive; null while it is still usable.'),
                            withdrawn: z.object({
                                at: z.number().describe('When new production stopped, epoch ms.'),
                                reason: z.string().describe('field_map_incorrect (ours to fix) or authority_withdrew (the publisher\'s decision).'),
                            }).nullable().describe('The withdrawal that stopped new production, or null while the revision is live.'),
                            present: z.boolean().describe("Whether the authority's verified PDF is in this deployment's storage."),
                            sizeBytes: z.number().nullable().describe('Size of the stored PDF, or null when nothing is stored.'),
                            uploadedAt: z.number().nullable().describe('When the stored bytes were written, epoch ms, or null when nothing is stored.'),
                        })).describe('Every revision this build publishes, in catalogue order.'),
                        // The other two prerequisites. Present on THIS response
                        // rather than an endpoint of its own because a screen
                        // that had to join two calls shows the join wrong on the
                        // day one of them fails — the same reasoning that put
                        // presence on this read in the first place.
                        readiness: z.object({
                            forms: z.array(z.object({
                                formId: z.string().describe('Stable id of the form.'),
                                formTitle: z.string().describe("The form's own published name."),
                                currentRevision: z.string().nullable().describe('The revision in force TODAY, or null when none is. Readiness is answered for that revision only: a superseded revision whose PDF is stored does not make a job booked today producible.'),
                                templateInstalled: z.boolean().describe('A template in this workspace declares this form.'),
                                sourceStored: z.boolean().describe("The authority's PDF for the revision in force is in this deployment's storage."),
                            })).describe('One row per form this build publishes.'),
                            licenceClass: z.object({
                                filled: z.number().describe('Active non-agent members whose printed licence class is set.'),
                                total: z.number().describe('Active non-agent members. Agents cannot sign a form, so they are not counted.'),
                            }).describe('A fraction, not a flag: "some inspectors can produce this and some cannot" is the true and useful state.'),
                        }).optional().describe('Whether a job booked TODAY could produce each form, across all three prerequisites. OMITTED — never sent as an empty shape — when it could not be computed: a card of crosses built from a query that never answered would read as "nothing is set up", which is a claim about the workspace.'),
                    })),
                },
            },
            description: 'The catalogue, with storage presence per revision',
        },
    },
    operationId: 'listStatutoryFormSources',
    description: "Every statutory revision this software publishes, and whether this deployment already holds the issuing authority's PDF for it. A revision with no stored PDF can be installed from a package but can produce nothing, so this is the read that says which uploads are still owed.",
}, { scopes: ['admin'], tier: 'extended' }));

const uploadSourceRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/statutory-forms/{formId}/source',
    tags: ['admin'],
    summary: 'Upload the authority PDF for a revision',
    middleware: [requireRole('owner')],
    request: {
        params: z.object({
            formId: z.string().trim().min(1).describe('Stable id of the statutory form itself, never one of its revisions, e.g. tx_trec_rei.'),
        }).describe('The form whose published PDF is being supplied.'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        file: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('The authority\'s published PDF for this revision, exactly as downloaded and unmodified.'),
                        revision: z.string().describe('The revision label printed on the document itself, verbatim, e.g. 7-6 or Rev. 04/26.'),
                    }).describe('The revision being supplied and the bytes claimed to be it.'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        key: z.string().describe('Storage key the verified bytes were written to, shared by every workspace in this deployment.'),
                        formId: z.string().describe('Stable id of the statutory form the bytes belong to.'),
                        revision: z.string().describe('The revision label the stored bytes were verified against.'),
                        sha256: z.string().describe('sha256 of the stored bytes, lowercase hex, equal to the value this revision records.'),
                    })),
                },
            },
            description: 'Stored',
        },
        400: { description: 'The bytes are not the ones this revision records' },
        404: { description: 'This software publishes no such revision' },
    },
    operationId: 'uploadStatutoryFormSource',
    description: "Supply the issuing authority's own published PDF for one revision of one statutory form. The upload is verified against the sha256 that revision records and refused if it does not match, naming both values. The bytes are never fetched on the operator's behalf: the source URL is provenance for a human, and an authority may publish a superseded revision at its most obvious address.",
}, { scopes: ['admin'], tier: 'extended' }));

const adminStatutorySourceRoutes = createApiRouter()
    .openapi(listSourcesRoute, async (c) => {
        // `c.env.PHOTOS` may be absent in a deployment that never bound a
        // bucket. Passed through as `undefined` rather than asserted: the
        // service reports that as `storageBound: false`, which is the honest
        // answer, where a throw here would show the operator a broken page
        // instead of the reason their uploads cannot land.
        const bucket = c.env.PHOTOS as R2Bucket | undefined;
        const data = await listStatutoryFormSources({
            bucket,
            versions: PUBLISHED_FORM_VERSIONS,
        });
        // The other two prerequisites, answered here because this is the only
        // screen where somebody is thinking about them. The rows below say
        // whether the PDF is stored; on their own they let an owner finish the
        // one job they can do and still be missing a template or a licence
        // class — each of which is discovered later, by somebody else, mid-job.
        //
        // BEST-EFFORT, AND THAT IS THE POINT. The rows are what this page is
        // for: an owner comes here to supply a document. Readiness is an
        // addition, and an addition that can take the upload screen down with
        // it when a query fails is a net loss. On failure the key is OMITTED —
        // never sent as an empty shape, which the client would render as a card
        // of crosses and read as "nothing is set up", a claim about the
        // workspace made from a query that never answered.
        let readiness;
        try {
            readiness = await statutoryReadiness({
                db: getDrizzle(c),
                tenantId: c.get('tenantId'),
                bucket,
                versions: PUBLISHED_FORM_VERSIONS,
                now: Date.now(),
            });
        } catch (err) {
            logger.warn('statutory readiness could not be computed; the upload rows are unaffected', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
        return c.json({
            success: true as const,
            data: { ...data, ...(readiness ? { readiness } : {}) },
        }, 200);
    })
    .openapi(uploadSourceRoute, async (c) => {
        const { formId } = c.req.valid('param');
        const form = await c.req.parseBody();
        const file = form['file'];
        const revisionRaw = form['revision'];

        if (!(file instanceof File)) {
            throw Errors.BadRequest("A `file` part carrying the authority's PDF is required.");
        }
        const revision = typeof revisionRaw === 'string' ? revisionRaw.trim() : '';
        if (revision === '') {
            throw Errors.BadRequest(
                'A `revision` part is required, spelled exactly as the revision is '
                + 'printed on the document.',
            );
        }

        const data = await storeStatutoryFormSource({
            bucket: c.env.PHOTOS,
            versions: PUBLISHED_FORM_VERSIONS,
            formId,
            revision,
            bytes: new Uint8Array(await file.arrayBuffer()),
        });
        return c.json({ success: true as const, data }, 200);
    });

export default adminStatutorySourceRoutes;
