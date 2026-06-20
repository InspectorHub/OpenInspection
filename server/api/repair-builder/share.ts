/**
 * Repair Request Builder — public share/PDF/email route definitions.
 *
 * These three endpoints are fully independent of the CRUD/source routes: the
 * shareToken IS the credential (no portal/agent/owner access resolution), and
 * they are publish-gated via runShareGate. The route definitions, schemas, and
 * the share-email HTML escaper are extracted here (pure movement); the handlers
 * are chained onto the aggregator router in server/api/repair-builder.ts so the
 * combined RepairBuilderApi type and every route path/method stay identical.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

// Share route schemas

const ShareTokenParamsSchema = z.object({
    shareToken: z.string().describe('Opaque share token for the repair request.'),
});

const ShareViewResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        propertyAddress: z.string().nullable(),
        customIntro:     z.string().nullable(),
        items:           z.array(z.any()),
        creditTotal:     z.number(),
    }),
});

const ShareEmailBodySchema = z.object({
    to:      z.string().email('Invalid email address').describe('Recipient email address for the share link.'),
    message: z.string().optional().describe('Optional personal message included in the email.'),
});

export const shareViewRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/repair-request/share/{shareToken}',
    tags:    ['inspections', 'public'],
    summary: 'Public share view of a repair request (publish-gated)',
    request: { params: ShareTokenParamsSchema },
    responses: {
        200: { content: { 'application/json': { schema: ShareViewResponseSchema } }, description: 'Repair request share view' },
        403: { description: 'Report not published' },
        404: { description: 'Unknown share token' },
    },
    operationId: 'getRepairRequestShareView',
    description: 'Returns the property address, custom intro, items, and credit total for a shared repair request. No login required; shareToken is the credential. Report must be published.',
}, { scopes: [], tier: 'extended' }));

export const sharePdfRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/repair-request/share/{shareToken}/pdf',
    tags:    ['inspections', 'public'],
    summary: 'Download a PDF of a shared repair request (publish-gated)',
    request: { params: ShareTokenParamsSchema },
    responses: {
        200: { description: 'PDF binary' },
        403: { description: 'Report not published' },
        404: { description: 'Unknown share token' },
    },
    operationId: 'getRepairRequestSharePdf',
    description: 'Renders a PDF of the repair request share page via Browser Rendering. Report must be published.',
}, { scopes: [], tier: 'extended' }));

export const shareEmailRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/repair-request/share/{shareToken}/email',
    tags:    ['inspections', 'public'],
    summary: 'Email a shared repair request link (publish-gated)',
    request: {
        params: ShareTokenParamsSchema,
        body:   { content: { 'application/json': { schema: ShareEmailBodySchema } }, required: true },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Email sent' },
        400: { description: 'Invalid request body' },
        403: { description: 'Report not published' },
        404: { description: 'Unknown share token' },
    },
    operationId: 'emailRepairRequestShare',
    description: 'Sends the share URL to a contractor or other recipient. Rate-limited. Report must be published.',
}, { scopes: [], tier: 'extended' }));

export function escapeHtmlShare(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
