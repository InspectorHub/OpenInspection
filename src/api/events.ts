import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';

const routes = new OpenAPIHono<HonoConfig>();

const TypeBody = z.object({
    name:               z.string().min(1),
    slug:               z.string().min(1).regex(/^[a-z0-9_]+$/),
    defaultDurationMin: z.number().int().positive().default(30),
    defaultPriceCents:  z.number().int().min(0).default(0),
    color:              z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
    sortOrder:          z.number().int().min(0).default(0),
});

const EventBody = z.object({
    eventTypeId:  z.string().min(1),
    inspectorId:  z.string().optional(),
    scheduledAt:  z.string().datetime(),
    durationMin:  z.number().int().positive(),
    priceCents:   z.number().int().min(0).default(0),
    notes:        z.string().optional(),
});

const EventStatusBody = z.object({
    status: z.enum(['scheduled', 'completed', 'results_received', 'cancelled']),
});

// ---- Event types CRUD ----

routes.get('/event-types', requireRole(['owner', 'admin', 'inspector']), async (c) => {
    const data = await c.var.services.event.listEventTypes(c.get('tenantId'));
    return c.json({ success: true, data });
});

routes.post('/event-types', requireRole(['owner', 'admin']), async (c) => {
    const parsed = TypeBody.safeParse(await c.req.json());
    if (!parsed.success) throw Errors.BadRequest('Invalid event type', parsed.error.flatten().fieldErrors);
    const row = await c.var.services.event.createEventType(c.get('tenantId'), parsed.data);
    return c.json({ success: true, data: row }, 201);
});

routes.put('/event-types/:id', requireRole(['owner', 'admin']), async (c) => {
    const id = c.req.param('id') as string;
    const parsed = TypeBody.partial().safeParse(await c.req.json());
    if (!parsed.success) throw Errors.BadRequest('Invalid event type', parsed.error.flatten().fieldErrors);
    await c.var.services.event.updateEventType(c.get('tenantId'), id, parsed.data);
    return c.json({ success: true });
});

routes.delete('/event-types/:id', requireRole(['owner', 'admin']), async (c) => {
    const id = c.req.param('id') as string;
    await c.var.services.event.deactivateEventType(c.get('tenantId'), id);
    return c.json({ success: true });
});

routes.post('/event-types/seed', requireRole(['owner', 'admin']), async (c) => {
    const r = await c.var.services.event.bulkSeed(c.get('tenantId'));
    return c.json({ success: true, data: r });
});

// ---- Inspection events ----

routes.get('/inspections/:inspectionId/events', requireRole(['owner', 'admin', 'inspector']), async (c) => {
    const inspectionId = c.req.param('inspectionId') as string;
    const data = await c.var.services.event.listInspectionEvents(c.get('tenantId'), inspectionId);
    return c.json({ success: true, data });
});

routes.post('/inspections/:inspectionId/events', requireRole(['owner', 'admin', 'inspector']), async (c) => {
    const inspectionId = c.req.param('inspectionId') as string;
    const parsed = EventBody.safeParse(await c.req.json());
    if (!parsed.success) throw Errors.BadRequest('Invalid event', parsed.error.flatten().fieldErrors);
    const row = await c.var.services.event.createEvent(c.get('tenantId'), inspectionId, {
        ...parsed.data,
        scheduledAt: new Date(parsed.data.scheduledAt),
    });
    return c.json({ success: true, data: row }, 201);
});

routes.put('/events/:id', requireRole(['owner', 'admin', 'inspector']), async (c) => {
    const id = c.req.param('id') as string;
    const parsed = EventStatusBody.safeParse(await c.req.json());
    if (!parsed.success) throw Errors.BadRequest('Invalid status', parsed.error.flatten().fieldErrors);
    await c.var.services.event.updateEventStatus(c.get('tenantId'), id, parsed.data.status);
    return c.json({ success: true });
});

routes.delete('/events/:id', requireRole(['owner', 'admin']), async (c) => {
    const id = c.req.param('id') as string;
    await c.var.services.event.deleteEvent(c.get('tenantId'), id);
    return c.json({ success: true });
});

routes.get('/events/upcoming', requireRole(['owner', 'admin', 'inspector']), async (c) => {
    const days = parseInt(c.req.query('days') || '7', 10);
    const from = Date.now();
    const to   = from + days * 86_400_000;
    const data = await c.var.services.event.listEventsByDateRange(c.get('tenantId'), from, to);
    return c.json({ success: true, data });
});

export default routes;
