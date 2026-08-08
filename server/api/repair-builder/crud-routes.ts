/**
 * Repair Request Builder — CRUD route definitions (list / items / intro).
 *
 * Extracted from server/api/repair-builder.ts (pure movement), mirroring the
 * split already made for the share routes in ./share.ts: the route definitions
 * and their request/response schemas live here, the handlers stay chained onto
 * the aggregator router in server/api/repair-builder.ts so the combined
 * RepairBuilderApi type and every route path/method stay identical.
 *
 * All five paths are scoped to (tenant, inspection id) and, below the item
 * level, to a repair-request id — the scoping itself is enforced in the
 * handlers and the service, not here; these are shapes only.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
// The two item-body shapes live in lib/validations (house rule); they were
// inline here until #275 added a field to both.
import { ItemBodySchema, ItemPatchSchema } from '../../lib/validations/repair-builder.schema';

// ---------------------------------------------------------------------------
// Param / query / body schemas
// ---------------------------------------------------------------------------

const BuilderParamsSchema = z.object({
    tenant: z.string().describe('Tenant slug (display only; tenant resolved from token).'),
    id:     z.string().describe('Inspection id.'),
});

const BuilderListParamsSchema = BuilderParamsSchema.extend({
    rrId: z.string().describe('Repair request id.'),
});

const BuilderItemParamsSchema = BuilderListParamsSchema.extend({
    itemId: z.string().describe('Repair request item id.'),
});

const BuilderQuerySchema = z.object({
    token: z.string().optional().describe('Portal access token.'),
});

const IntroPatchSchema = z.object({
    customIntro: z.string().nullable().optional().describe('Document-level intro shown atop the repair request.'),
});

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

export const createListRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/repair-builder/{tenant}/{id}',
    tags:    ['inspections', 'public'],
    summary: 'Create a new repair request list for an inspection',
    request: {
        params: BuilderParamsSchema,
        query:  BuilderQuerySchema,
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.any() }) } }, description: 'Created repair request' },
        401: { description: 'No valid access credential' },
        403: { description: 'Report not published or tenant feature disabled' },
    },
    operationId: 'createRepairList',
    description: 'Creates a new repair request list scoped to the calling creator.',
}, { scopes: ['write'], tier: 'extended' }));

export const getListRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}',
    tags:    ['inspections', 'public'],
    summary: 'Get a repair request list with items and credit total',
    request: {
        params: BuilderListParamsSchema,
        query:  BuilderQuerySchema,
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.any() }) } }, description: 'Repair request + items + creditTotal' },
        401: { description: 'No valid access credential' },
        403: { description: 'Report not published or tenant feature disabled' },
        404: { description: 'Repair request not found' },
    },
    operationId: 'getRepairList',
    description: 'Returns a repair request with its items and summed credit total.',
}, { scopes: ['read'], tier: 'extended' }));

export const addItemRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}/items',
    tags:    ['inspections', 'public'],
    summary: 'Add an item to a repair request list',
    request: {
        params: BuilderListParamsSchema,
        query:  BuilderQuerySchema,
        body:   { content: { 'application/json': { schema: ItemBodySchema } }, required: true },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.any() }) } }, description: 'Added item' },
        400: { description: 'Validation error' },
        401: { description: 'No valid access credential' },
        403: { description: 'Not the creator, report not published, or an inspector-authored action tag' },
    },
    operationId: 'addRepairItem',
    description: 'Adds a defect item to the caller\'s repair request. Creator-auth enforced; a non-null repairActionTag from an inspector is refused with 403.',
}, { scopes: ['write'], tier: 'extended' }));

export const updateItemRoute = createRoute(withMcpMetadata({
    method:  'patch',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}/items/{itemId}',
    tags:    ['inspections', 'public'],
    summary: 'Update a repair request item (credit, note, sortOrder, action tag)',
    request: {
        params: BuilderItemParamsSchema,
        query:  BuilderQuerySchema,
        body:   { content: { 'application/json': { schema: ItemPatchSchema } }, required: true },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Updated' },
        400: { description: 'Validation error' },
        401: { description: 'No valid access credential' },
        403: { description: 'Not the creator, report not published, or an inspector-authored action tag' },
    },
    operationId: 'updateRepairItem',
    description: 'Patches requestedCreditCents, note, sortOrder and/or repairActionTag on an item. Creator-auth enforced; a non-null repairActionTag from an inspector is refused with 403.',
}, { scopes: ['write'], tier: 'extended' }));

export const removeItemRoute = createRoute(withMcpMetadata({
    method:  'delete',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}/items/{itemId}',
    tags:    ['inspections', 'public'],
    summary: 'Remove an item from a repair request list',
    request: {
        params: BuilderItemParamsSchema,
        query:  BuilderQuerySchema,
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Deleted' },
        401: { description: 'No valid access credential' },
        403: { description: 'Not the creator or report not published' },
    },
    operationId: 'removeRepairItem',
    description: 'Removes an item from the caller\'s repair request. Creator-auth enforced.',
}, { scopes: ['write'], tier: 'extended' }));

export const setIntroRoute = createRoute(withMcpMetadata({
    method:  'patch',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}',
    tags:    ['inspections', 'public'],
    summary: 'Set or clear the custom intro for a repair request list',
    request: {
        params: BuilderListParamsSchema,
        query:  BuilderQuerySchema,
        body:   { content: { 'application/json': { schema: IntroPatchSchema } }, required: true },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Updated' },
        401: { description: 'No valid access credential' },
        403: { description: 'Not the creator or report not published' },
    },
    operationId: 'setRepairIntro',
    description: 'Sets or clears the customIntro field on a repair request. Creator-auth enforced.',
}, { scopes: ['write'], tier: 'extended' }));
