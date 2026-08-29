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
import { PUBLISHED_FORM_VERSIONS } from '../../lib/statutory/forms';
import { storeStatutoryFormSource } from '../../services/statutory/source-upload';

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
