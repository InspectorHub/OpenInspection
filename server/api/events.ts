import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { EventTypeListResponseSchema, InspectionEventListResponseSchema } from '../lib/validations/event.schema';
import { requireRole } from '../lib/middleware/rbac';
import { isAdminRole } from '../lib/auth/roles';
import { Errors } from '../lib/errors';
import { deniedByRule, deniedNeedsRole } from '../lib/permission-denied';
import { moneyView, guardMoneyWrite } from '../lib/auth/money-access';
import { requireVisibleEvent, resolveInspectionScope } from '../lib/inspection/visibility';
import { getDrizzle } from '../lib/route-helpers';

const TypeBody = z.object({
    name:               z.string().min(1).describe('Display name of the event type, shown when scheduling a visit and on the calendar.'),
    slug:               z.string().min(1).regex(/^[a-z0-9_]+$/).describe('Stable lowercase identifier of the event type, unique within the company; the starter-type seeding matches on it to skip types that already exist.'),
    defaultDurationMin: z.number().int().positive().default(30).describe('Length in minutes that a new visit of this type is given unless the caller overrides it.'),
    defaultPriceCents:  z.number().int().min(0).default(0).describe('Price in cents that a new visit of this type starts with unless the caller overrides it.'),
    color:              z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1').describe('Hex colour used to draw visits of this type on the calendar.'),
    sortOrder:          z.number().int().min(0).default(0).describe('Position of the event type in lists, lowest first.'),
    // Hours after completion before the follow-up is queued. `.optional()` with
    // NO `.default()`: omitted on create leaves the column default (72), so the
    // schema never invents a value of its own. `min(0)` because zero is a real
    // setting: a sewer scope's results exist when the camera comes out.
    followUpDelayHours: z.number().int().min(0).max(8760).optional()
        .describe('Hours after a visit is completed before its follow-up is queued. 0 = immediately.'),
});

const EventBody = z.object({
    eventTypeId:  z.string().min(1).describe('Id of the event type this visit is an instance of.'),
    inspectorId:  z.string().optional().describe('Id of the user assigned to carry out the visit; leave out to leave it unassigned.'),
    scheduledAt:  z.string().datetime().describe('Start of the visit as an ISO 8601 date-time; the 24-hour reminder is scheduled relative to it.'),
    durationMin:  z.number().int().positive().describe('Length of the visit in minutes.'),
    priceCents:   z.number().int().min(0).default(0).describe('Price of this visit in cents.'),
    notes:        z.string().optional().describe('Free-text notes attached to the visit.'),
});

const EventStatusBody = z.object({
    status: z.enum(['scheduled', 'completed', 'results_received', 'cancelled']).describe('New lifecycle status of the visit; moving to completed, results received or cancelled stamps the matching timestamp on the visit.'),
});

// ---- Event types CRUD ----

// POST and PUT stay plain handlers: the money guard reads the RAW body before the schema's defaults apply, and
// the status change authorises on the body as well, neither of which a route validator can express. They follow
// the OpenAPI routes in the chain because `.post()` returns a plain Hono, which has no `.openapi()`.
const listEventTypesRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/event-types', tags: ['calendar'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: { 200: { content: { 'application/json': { schema: EventTypeListResponseSchema } }, description: 'Event types' } },
    operationId: 'listVisitEventTypes', summary: 'List the company visit event types',
    description: 'Lists the event types the company schedules visits with, such as a radon drop-off, ordered by sort order. Price fields are left out for callers without the inspection-fees capability.',
}, { scopes: ['read'], tier: 'extended' }));

const listInspectionEventsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/inspections/{inspectionId}/events', tags: ['calendar'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ inspectionId: z.string().describe('Id of the inspection whose visits to list.') }) },
    responses: { 200: { content: { 'application/json': { schema: InspectionEventListResponseSchema } }, description: 'Visits of the inspection' } },
    operationId: 'listInspectionEvents', summary: 'List the visits of an inspection',
    description: 'Lists the scheduled visits (events) of one inspection, earliest first. The price is left out for callers without the inspection-fees capability.',
}, { scopes: ['read'], tier: 'extended' }));

const deleteEventRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/events/{id}', tags: ['calendar'],
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: z.object({ id: z.string().describe('Id of the visit to delete.') }) },
    responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('Always true on success.') }) } }, description: 'Deleted' } },
    operationId: 'deleteInspectionEvent', summary: 'Delete a visit from an inspection',
    description: 'Deletes one scheduled visit (event). Owner or manager only.',
}, { scopes: ['write'], tier: 'extended' }));

const eventsRoutes = createApiRouter()
    .openapi(listEventTypesRoute, async (c) => {
        const data = await c.var.services.event.listEventTypes(c.get('tenantId'));
        return c.json({ success: true as const, data: await moneyView(c, data, 'inspectionFees') }, 200);
    })
    .openapi(listInspectionEventsRoute, async (c) => {
        const { inspectionId } = c.req.valid('param');
        const data = await c.var.services.event.listInspectionEvents(c.get('tenantId'), inspectionId);
        return c.json({ success: true as const, data: await moneyView(c, data, 'inspectionFees') }, 200);
    })
    .openapi(deleteEventRoute, async (c) => {
        const { id } = c.req.valid('param');
        await c.var.services.event.deleteEvent(c.get('tenantId'), id);
        return c.json({ success: true as const }, 200);
    })
    .post('/event-types', requireRole('owner', 'manager'), async (c) => {
        // Checked on the RAW body: the schema's default of 0 would otherwise make
        // every create look like it sets a price.
        const parsed = TypeBody.safeParse(await guardMoneyWrite(c, await c.req.json(), null));
        if (!parsed.success) throw Errors.BadRequest('Invalid event type', parsed.error.flatten().fieldErrors);
        const row = await c.var.services.event.createEventType(c.get('tenantId'), parsed.data);
        return c.json({ success: true, data: await moneyView(c, row, 'inspectionFees') }, 201);
    })
    // ---- Inspection events ----
    .post('/inspections/:inspectionId/events', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const inspectionId = c.req.param('inspectionId') as string;
        const parsed = EventBody.safeParse(await guardMoneyWrite(c, await c.req.json(), null));
        if (!parsed.success) throw Errors.BadRequest('Invalid event', parsed.error.flatten().fieldErrors);
        const row = await c.var.services.event.createEvent(c.get('tenantId'), inspectionId, {
            ...parsed.data,
            scheduledAt: new Date(parsed.data.scheduledAt),
        });
        return c.json({ success: true, data: await moneyView(c, row, 'inspectionFees') }, 201);
    })
    .put('/events/:id', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const id = c.req.param('id') as string;
        const parsed = EventStatusBody.safeParse(await c.req.json());
        if (!parsed.success) throw Errors.BadRequest('Invalid status', parsed.error.flatten().fieldErrors);
        // Completing a visit is the FIELD's own act: the inspector standing on
        // site is the person who knows it is over, so every role on this route
        // may do it. Recording that lab RESULTS arrived is an office act about a
        // different event entirely, so it is owner/manager.
        //
        // The distinction is body-dependent — one method, one path, two very
        // different transitions — so route-level `requireRole` cannot express
        // it. `visitActions` (app/components/inspector-portal/VisitsCard.tsx)
        // declines to OFFER the verb; this is where it is ENFORCED, so a
        // hand-rolled request cannot walk around the UI.
        // Staff are the office: they schedule visits but never change a visit's
        // status (completing or cancelling one moves the job), whatever the value.
        if (c.get('userRole') === 'staff') {
            throw deniedByRule(c, "Office staff accounts schedule visits but cannot change a visit's status", 'An owner, manager or inspector');
        }
        if (parsed.data.status === 'results_received' && !isAdminRole(c.get('userRole'))) {
            throw deniedNeedsRole(c, ['owner', 'manager'], 'Marking results as received is an owner or manager action');
        }
        // A visit of an inspection the caller cannot see is not found, whatever the body says.
        await requireVisibleEvent(getDrizzle(c), await resolveInspectionScope(c), c.get('tenantId'), id);
        await c.var.services.event.updateEventStatus(c.get('tenantId'), id, parsed.data.status);
        return c.json({ success: true });
    });

export type EventsApi = typeof eventsRoutes;

export default eventsRoutes;
