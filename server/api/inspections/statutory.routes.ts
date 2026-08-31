/**
 * The route contracts for the statutory-form endpoints. Handlers live beside
 * them in `statutory.ts`.
 *
 * -- WHY THEY ARE SEPARATED ---------------------------------------------------
 * `statutory.ts` reached the 400-line ceiling, and this is the seam that
 * survives the file growing again: a route declaration is a CONTRACT -- path,
 * verb, role, request shape, the status codes and what each one means -- while
 * a handler is the behaviour that honours it. They change for different reasons
 * and are read by different people. The published OpenAPI document is generated
 * from this file alone; someone auditing what this software exposes, or what
 * scope and tier reach it, has one file to read and no request handling in the
 * way of it.
 *
 * ⚠️ Every `operationId` here appears in `server/lib/mcp/openapi-snapshot.json`.
 * Changing one is an API-surface change and the snapshot has to be regenerated
 * with it (`npm run mcp:snapshot`), or `tests/unit/mcp/snapshot-drift.spec.ts`
 * fails -- which is the point of that test.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

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
        422: { description: 'The inspection cannot fill this form yet — the message names the fields' },
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
// AddInstanceBodySchema is deliberately NOT exported: it is the request body
// of one route in this file and has no second reader. Exporting it would add a
// name to the module surface that nothing imports.
export { statutoryFormRoute, statutoryOfferRoute, addInstanceRoute };
