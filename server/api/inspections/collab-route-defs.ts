import { createRoute, z } from '@hono/zod-openapi';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

/**
 * Route definitions for the JSON collab routes (snapshot history, restore, restructure, follow-up). Each handler
 * runs `authorizeCollab` first and answers its plain-text refusals, then forwards to the Durable Object and
 * returns that response unchanged, so the refusals and the object's own non-200 answers are declared as
 * `text/plain`, except 404, which can be plain text or the object's JSON and is described in words. A body is never declared as a request schema: the handler reads and validates it after the
 * authorization, answering its own `{ error }` 400, and a validator in front of it would answer first.
 * None is offered to MCP: they edit or expose a live report document through a Durable Object.
 */
const idParam = z.object({ id: z.string().describe('Id of the inspection whose report document is addressed.') });
const text = (what: string) => ({ content: { 'text/plain': { schema: z.string().describe('Short plain-text reason.') } }, description: what });
const json = <S extends z.ZodType>(schema: S, what: string) => ({ content: { 'application/json': { schema } }, description: what });
const okBody = z.object({ ok: z.literal(true).describe('Always true when the change was applied.') });
const errorBody = z.object({ error: z.string().describe('Short message saying what was wrong with the request.') });
const notRecorded = z.object({ ok: z.literal(false).describe('Always false when nothing was recorded.'), reason: z.string().describe('Why the verdict could not be recorded.') });

/** What every collab route answers before it reaches the Durable Object. */
const refusals = {
    401: text('No signed-in user'),
    403: text('The caller is not on the inspection roster'),
    // No `content` on purpose: a status without one is what lets a handler return the Durable Object response as it is.
    404: { description: 'No such inspection or report, or the Durable Object has no such snapshot; the body is plain text' },
    501: text('Collaborative editing is not available on this deployment'),
};

const snapshotMeta = z.object({
    seq: z.number().describe('Snapshot sequence number; starts at 0 and only increases.'),
    atMs: z.number().describe('When the snapshot was taken, in epoch milliseconds.'),
    byUserId: z.string().nullable().describe('Id of the user the snapshot was taken for; null for an automatic one.'),
    reason: z.string().optional().describe('Why the snapshot was taken, such as manual or import; absent for an ordinary one.'),
});

export const collabSnapshotListRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/collab/snapshots', tags: ['inspections'],
    request: { params: idParam },
    responses: { 200: json(z.array(snapshotMeta).describe('The version history of the report document, without the projections.'), 'Snapshot list'), ...refusals },
    operationId: 'listCollabSnapshots', summary: 'List the version history of a report document',
    description: 'Lists the snapshots kept for the inspection report document, taken automatically and on demand, without their contents. Callers on the inspection roster only; the response is the Durable Object answer unchanged.',
}, { scopes: [], tier: 'excluded' }));

export const collabSnapshotGetRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/collab/snapshots/{seq}', tags: ['inspections'],
    request: { params: idParam.extend({ seq: z.string().describe('Snapshot sequence number, a whole number of zero or more.') }) },
    responses: {
        200: json(z.record(z.string(), z.unknown()).describe('The full snapshot record, including the projection of the report document.'), 'One snapshot'),
        400: json(errorBody, 'The sequence number is not a whole number of zero or more'),
        ...refusals,
    },
    operationId: 'getCollabSnapshot', summary: 'Get one snapshot of a report document',
    description: 'Returns one snapshot in full, including the projection of the report document, so two versions can be compared. A sequence number the document has no snapshot for answers 404 from the Durable Object with a plain-text body. Callers on the inspection roster only.',
}, { scopes: [], tier: 'excluded' }));

export const collabSnapshotCaptureRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/collab/snapshots', tags: ['inspections'],
    request: { params: idParam },
    responses: { 200: json(z.object({ seq: z.number().describe('Sequence number of the new snapshot.'), atMs: z.number().describe('When it was taken, in epoch milliseconds.') }), 'Snapshot captured'), ...refusals },
    operationId: 'captureCollabSnapshot', summary: 'Capture a snapshot of a report document',
    description: 'Takes a snapshot of the inspection report document now, for the version history. No body. Callers on the inspection roster only.',
}, { scopes: [], tier: 'excluded' }));

export const collabRestoreRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/collab/restore', tags: ['inspections'],
    request: { params: idParam },
    responses: { 200: json(okBody, 'Document restored'), 400: json(errorBody, 'The body is not JSON or not a valid restore request'), ...refusals },
    operationId: 'restoreCollabSnapshot', summary: 'Restore a report document to a snapshot',
    description: 'Replaces the live report document with a snapshot and makes every connected editor reload it. The JSON body is {seq}, the whole-number sequence number of the snapshot to restore. A sequence number the document has no snapshot for answers 404 from the Durable Object with a plain-text body. Callers on the inspection roster only.',
}, { scopes: [], tier: 'excluded' }));

export const collabRestructureRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/collab/restructure', tags: ['inspections'],
    request: { params: idParam },
    responses: { 200: json(okBody, 'Document restructured'), ...refusals },
    operationId: 'restructureCollabDocument', summary: 'Converge a report document after a template change',
    description: 'Called after the template snapshot of the inspection changed: the live document is diffed against the new snapshot, added items are seeded, removed ones are dropped, and every connected editor resyncs. No body. Callers on the inspection roster only.',
}, { scopes: [], tier: 'excluded' }));

export const collabFollowupRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/collab/followup', tags: ['inspections'],
    request: { params: idParam },
    responses: {
        200: json(z.object({ ok: z.literal(true).describe('Always true when the verdict was recorded.'), findingKey: z.string().describe('Key of the carried finding that was updated.') }), 'Verdict recorded'),
        400: json(z.object({ error: z.string().describe('Short message saying what was wrong with the request.'), allowed: z.array(z.string()).optional().describe('The follow-up status keys the company accepts; present when the status is not one of them.') }), 'The body is not valid, or the status is not in the company vocabulary'),
        401: refusals[401],
        403: refusals[403],
        404: { description: 'No such inspection or report (plain text), or no such carried item (JSON with ok false and a reason)' },
        409: json(notRecorded, 'The item cannot take a follow-up verdict'),
        501: refusals[501],
    },
    operationId: 'recordCollabFollowup', summary: 'Record the follow-up verdict of a carried item',
    description: 'Records the follow-up verdict of one item carried into a re-inspection. The JSON body is {itemId, status, notes?}: status is a follow-up status key of the company, or null to clear the answer, and notes of at most 4000 characters replace the note when present. Callers on the inspection roster only.',
}, { scopes: [], tier: 'excluded' }));
