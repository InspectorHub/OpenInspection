import {} from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';

const TypeBody = z.object({
    name:               z.string().min(1).describe('TODO describe name field for the OpenInspection MCP integration'),
    slug:               z.string().min(1).regex(/^[a-z0-9_]+$/).describe('TODO describe slug field for the OpenInspection MCP integration'),
    defaultDurationMin: z.number().int().positive().default(30).describe('TODO describe defaultDurationMin field for the OpenInspection MCP integration'),
    defaultPriceCents:  z.number().int().min(0).default(0).describe('TODO describe defaultPriceCents field for the OpenInspection MCP integration'),
    color:              z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1').describe('TODO describe color field for the OpenInspection MCP integration'),
    sortOrder:          z.number().int().min(0).default(0).describe('TODO describe sortOrder field for the OpenInspection MCP integration'),
});

const EventBody = z.object({
    eventTypeId:  z.string().min(1).describe('TODO describe eventTypeId field for the OpenInspection MCP integration'),
    inspectorId:  z.string().optional().describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    scheduledAt:  z.string().datetime().describe('TODO describe scheduledAt field for the OpenInspection MCP integration'),
    durationMin:  z.number().int().positive().describe('TODO describe durationMin field for the OpenInspection MCP integration'),
    priceCents:   z.number().int().min(0).default(0).describe('TODO describe priceCents field for the OpenInspection MCP integration'),
    notes:        z.string().optional().describe('TODO describe notes field for the OpenInspection MCP integration'),
});

const EventStatusBody = z.object({
    status: z.enum(['scheduled', 'completed', 'results_received', 'cancelled']).describe('TODO describe status field for the OpenInspection MCP integration'),
});

// ---- Event types CRUD ----

export const eventsRoutes = createApiRouter()
    .get('/event-types', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const data = await c.var.services.event.listEventTypes(c.get('tenantId'));
        return c.json({ success: true, data });
    })
    .post('/event-types', requireRole('owner', 'manager'), async (c) => {
        const parsed = TypeBody.safeParse(await c.req.json());
        if (!parsed.success) throw Errors.BadRequest('Invalid event type', parsed.error.flatten().fieldErrors);
        const row = await c.var.services.event.createEventType(c.get('tenantId'), parsed.data);
        return c.json({ success: true, data: row }, 201);
    })
    .put('/event-types/:id', requireRole('owner', 'manager'), async (c) => {
        const id = c.req.param('id') as string;
        const parsed = TypeBody.partial().safeParse(await c.req.json());
        if (!parsed.success) throw Errors.BadRequest('Invalid event type', parsed.error.flatten().fieldErrors);
        await c.var.services.event.updateEventType(c.get('tenantId'), id, parsed.data);
        return c.json({ success: true });
    })
    .delete('/event-types/:id', requireRole('owner', 'manager'), async (c) => {
        const id = c.req.param('id') as string;
        await c.var.services.event.deactivateEventType(c.get('tenantId'), id);
        return c.json({ success: true });
    })
    .post('/event-types/seed', requireRole('owner', 'manager'), async (c) => {
        const r = await c.var.services.event.bulkSeed(c.get('tenantId'));
        return c.json({ success: true, data: r });
    })
    // ---- Inspection events ----
    .get('/inspections/:inspectionId/events', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const inspectionId = c.req.param('inspectionId') as string;
        const data = await c.var.services.event.listInspectionEvents(c.get('tenantId'), inspectionId);
        return c.json({ success: true, data });
    })
    .post('/inspections/:inspectionId/events', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const inspectionId = c.req.param('inspectionId') as string;
        const parsed = EventBody.safeParse(await c.req.json());
        if (!parsed.success) throw Errors.BadRequest('Invalid event', parsed.error.flatten().fieldErrors);
        const row = await c.var.services.event.createEvent(c.get('tenantId'), inspectionId, {
            ...parsed.data,
            scheduledAt: new Date(parsed.data.scheduledAt),
        });
        return c.json({ success: true, data: row }, 201);
    })
    .put('/events/:id', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const id = c.req.param('id') as string;
        const parsed = EventStatusBody.safeParse(await c.req.json());
        if (!parsed.success) throw Errors.BadRequest('Invalid status', parsed.error.flatten().fieldErrors);
        await c.var.services.event.updateEventStatus(c.get('tenantId'), id, parsed.data.status);
        return c.json({ success: true });
    })
    .delete('/events/:id', requireRole('owner', 'manager'), async (c) => {
        const id = c.req.param('id') as string;
        await c.var.services.event.deleteEvent(c.get('tenantId'), id);
        return c.json({ success: true });
    })
    .get('/events/upcoming', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const days = parseInt(c.req.query('days') || '7', 10);
        const from = Date.now();
        const to   = from + days * 86_400_000;
        const data = await c.var.services.event.listEventsByDateRange(c.get('tenantId'), from, to);
        return c.json({ success: true, data });
    });

export type EventsApi = typeof eventsRoutes;

export default eventsRoutes;
