import { z } from '@hono/zod-openapi';
import { EVENT_STATUSES } from '../status/event-status';

/**
 * Event types and visits as the events routes answer them. The money fields (`defaultPriceCents`,
 * `priceCents`) are optional because the response is projected for the caller: someone without the
 * inspection-fees capability gets the row with those keys removed, not zeroed.
 */
export const EventTypeSchema = z.object({
    id:                 z.string().describe('Event type id.'),
    tenantId:           z.string().describe('Id of the company the event type belongs to.'),
    name:               z.string().describe('Display name of the event type.'),
    slug:               z.string().describe('Stable lowercase identifier of the event type, unique within the company.'),
    defaultDurationMin: z.number().describe('Length in minutes a new visit of this type is given by default.'),
    defaultPriceCents:  z.number().optional().describe('Default price in cents; absent when the caller may not see prices.'),
    color:              z.string().describe('Hex colour used to draw visits of this type on the calendar.'),
    sortOrder:          z.number().describe('Position of the event type in lists, lowest first.'),
    active:             z.boolean().describe('Whether the event type can be chosen for new visits.'),
    createdAt:          z.string().describe('When the event type was created, as an ISO 8601 timestamp.'),
    followUpDelayHours: z.number().describe('Hours after a visit is completed before its follow-up is queued.'),
}).openapi('EventType');

export const InspectionEventSchema = z.object({
    id:                z.string().describe('Visit id.'),
    tenantId:          z.string().describe('Id of the company the visit belongs to.'),
    inspectionId:      z.string().describe('Id of the inspection the visit belongs to.'),
    eventTypeId:       z.string().describe('Id of the event type this visit is an instance of.'),
    inspectorId:       z.string().nullable().describe('Id of the user assigned to the visit; null when unassigned.'),
    scheduledAt:       z.string().describe('Start of the visit as an ISO 8601 timestamp.'),
    durationMin:       z.number().describe('Length of the visit in minutes.'),
    priceCents:        z.number().optional().describe('Price of the visit in cents; absent when the caller may not see prices.'),
    status:            z.enum(EVENT_STATUSES).describe('Lifecycle status of the visit.'),
    notes:             z.string().nullable().describe('Free-text notes attached to the visit; null when none.'),
    completedAt:       z.string().nullable().describe('When the visit was completed; null until then.'),
    resultsReceivedAt: z.string().nullable().describe('When results were recorded as received; null until then.'),
    cancelledAt:       z.string().nullable().describe('When the visit was cancelled; null unless it was.'),
    createdAt:         z.string().describe('When the visit was created, as an ISO 8601 timestamp.'),
}).openapi('InspectionEvent');

export const EventTypeListResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.array(EventTypeSchema).describe('The company event types, lowest sort order first.'),
});

export const InspectionEventListResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.array(InspectionEventSchema).describe('The visits of the inspection, earliest first.'),
});
