import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { MessageTemplateService } from '../services/message-template.service';
import { smsSegmentInfo } from '../lib/sms/segments';
import { interpolate } from '../services/automation/shared';
import { buildTenantEmailService } from '../lib/email/build-email-service';
import { loadProviderForTenant } from '../lib/sms/resolve-twilio';
import { normalizeE164 } from '../lib/sms/phone';
import {
    CreateMessageTemplateSchema, UpdateMessageTemplateSchema, PreviewMessageTemplateSchema,
    TestSendMessageTemplateSchema, MessageTemplateSchema, MessageTemplateListResponseSchema,
} from '../lib/validations/message-template.schema';

const listRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/', tags: ['templates'],
    middleware: [requireRole('owner', 'manager')],
    request: { query: z.object({ channel: z.enum(['email', 'sms']).optional().describe('Filter by delivery channel: email or sms.') }) },
    responses: { 200: { content: { 'application/json': { schema: MessageTemplateListResponseSchema } }, description: 'Tenant message templates' } },
    operationId: 'listMessageTemplates',
    summary: 'List reusable message templates for the current tenant',
    description: 'Returns the tenant message templates, optionally filtered by channel (email | sms).',
}, { scopes: ['read'], tier: 'extended' }));

const createMtRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/', tags: ['templates'],
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: CreateMessageTemplateSchema } } } },
    responses: { 201: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: MessageTemplateSchema }) } }, description: 'Created' } },
    operationId: 'createMessageTemplate', summary: 'Create a message template',
    description: 'Creates a reusable email or SMS template for the current tenant.',
}, { scopes: ['write'], tier: 'extended' }));

const updateMtRoute = createRoute(withMcpMetadata({
    method: 'patch', path: '/{id}', tags: ['templates'],
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ id: z.string().describe('Message template ID to update.') }), body: { content: { 'application/json': { schema: UpdateMessageTemplateSchema } } } },
    responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: MessageTemplateSchema }) } }, description: 'Updated' } },
    operationId: 'updateMessageTemplate', summary: 'Update a message template',
    description: 'Updates a message template (name / subject / body / variables). Channel is immutable.',
}, { scopes: ['write'], tier: 'extended' }));

const duplicateRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/duplicate', tags: ['templates'],
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ id: z.string().describe('Message template ID to duplicate.') }) },
    responses: { 201: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: MessageTemplateSchema }) } }, description: 'Duplicated' } },
    operationId: 'duplicateMessageTemplate', summary: 'Duplicate a message template',
    description: 'Creates a non-seeded copy of the template with " (Copy)" appended to its name.',
}, { scopes: ['write'], tier: 'extended' }));

const deleteRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}', tags: ['templates'],
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ id: z.string().describe('Message template ID to delete.') }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Deleted' },
        409: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string(), referencing: z.array(z.object({ id: z.string(), name: z.string() })) }) } }, description: 'In use' },
    },
    operationId: 'deleteMessageTemplate', summary: 'Delete a message template',
    description: 'Deletes a template. Blocks with 409 and lists the referencing automations when the template is in use.',
}, { scopes: ['write'], tier: 'extended' }));

const previewRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/preview', tags: ['templates'],
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: PreviewMessageTemplateSchema } } } },
    responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({
        subject: z.string().optional(), html: z.string().optional(), text: z.string().optional(),
        segments: z.object({ encoding: z.string(), length: z.number(), segments: z.number() }).optional(),
    }) }) } }, description: 'Rendered preview' } },
    operationId: 'previewMessageTemplate', summary: 'Render a message template preview',
    description: 'Renders the email (subject + HTML) or SMS (text + segment count) with sample variables. Persists nothing.',
}, { scopes: ['read'], tier: 'extended' }));

const testSendRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/test-send', tags: ['templates'],
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: TestSendMessageTemplateSchema } } } },
    responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.boolean(), error: z.string().optional() }) } }, description: 'Send result' } },
    operationId: 'testSendMessageTemplate', summary: 'Send a test of a message template',
    description: 'Sends a test email or SMS rendering of the template to a typed recipient via the tenant-resolved transport (metering + consent respected).',
}, { scopes: ['write'], tier: 'extended' }));

export const messageTemplateRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { channel } = c.req.valid('query');
        const data = await new MessageTemplateService(c.env.DB).list(tenantId, channel);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(createMtRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const body = c.req.valid('json');
        const createPayload: { name: string; channel: 'email' | 'sms'; subject: string | null; body: string; variables?: string[] } = {
            name: body.name, channel: body.channel, subject: body.subject ?? null, body: body.body,
        };
        if (body.variables !== undefined) createPayload.variables = body.variables;
        const data = await new MessageTemplateService(c.env.DB).create(tenantId, createPayload);
        return c.json({ success: true as const, data }, 201);
    })
    .openapi(updateMtRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const raw = c.req.valid('json');
        const patch: Partial<{ name: string; subject: string | null; body: string; variables: string[] }> = {};
        if (raw.name !== undefined) patch.name = raw.name;
        if ('subject' in raw) patch.subject = raw.subject ?? null;
        if (raw.body !== undefined) patch.body = raw.body;
        if (raw.variables !== undefined) patch.variables = raw.variables;
        const data = await new MessageTemplateService(c.env.DB).update(tenantId, id, patch);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(duplicateRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const data = await new MessageTemplateService(c.env.DB).duplicate(tenantId, id);
        return c.json({ success: true as const, data }, 201);
    })
    .openapi(deleteRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const svc = new MessageTemplateService(c.env.DB);
        const refs = await svc.referencingAutomations(tenantId, id);
        if (refs.length > 0) {
            return c.json({ success: false as const, error: 'Template is in use by automations.', referencing: refs }, 409);
        }
        await svc.delete(tenantId, id);
        return c.json({ success: true as const }, 200);
    })
    .openapi(previewRoute, async (c) => {
        const { channel, subject, body, sampleVars } = c.req.valid('json');
        const vars = sampleVars ?? {};
        if (channel === 'sms') {
            const text = interpolate(body, vars);
            return c.json({ success: true as const, data: { text, segments: smsSegmentInfo(text) } }, 200);
        }
        // Email: interpolate the author body (same {{var}} dialect delivery uses).
        const renderedSubject = interpolate(subject ?? '', vars);
        const renderedHtml = interpolate(body, vars);
        return c.json({ success: true as const, data: { subject: renderedSubject, html: renderedHtml } }, 200);
    })
    .openapi(testSendRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { channel, subject, body, to, sampleVars } = c.req.valid('json');
        const vars = sampleVars ?? {};
        if (channel === 'sms') {
            const normalized = normalizeE164(to);
            if (!normalized) return c.json({ success: false, error: 'That phone number could not be parsed.' }, 200);
            const resolved = await loadProviderForTenant(c.env, tenantId);
            if (!resolved) return c.json({ success: false, error: 'SMS is not configured.' }, 200);
            const sendArgs: { from?: string; to: string; body: string } = { to: normalized, body: interpolate(body, vars) };
            if (resolved.from) sendArgs.from = resolved.from;
            const res = await resolved.provider.sendMessage(sendArgs);
            if (res.ok) {
                // WH-2 — seed a 'sent' delivery-status row for the returned id (non-fatal).
                const { drizzle } = await import('drizzle-orm/d1');
                const { recordSentStatus } = await import('./sms');
                await recordSentStatus(drizzle(c.env.DB), tenantId, res.id, Date.now());
            }
            return res.ok ? c.json({ success: true }, 200) : c.json({ success: false, error: res.error }, 200);
        }
        // Per-tenant email transport (resolves the tenant's own provider/keys).
        const emailSvc = await buildTenantEmailService(c.env, tenantId);
        const { delivered } = await emailSvc.sendEmail([to], interpolate(subject ?? '', vars), interpolate(body, vars));
        return delivered ? c.json({ success: true }, 200) : c.json({ success: false, error: 'Email is not configured.' }, 200);
    });

export default messageTemplateRoutes;
export type MessageTemplatesApi = typeof messageTemplateRoutes;
