import { z } from '@hono/zod-openapi';

/**
 * PATCH /api/inspections/:id/schedule — the one write that moves an inspection
 * in TIME and across PEOPLE at once, which is what a dispatch drag is.
 *
 * No field carries `.default()`, deliberately. This is a partial write: an
 * absent `durationMin` means "leave the booked duration alone", and a zod
 * default would silently turn that silence into an overwrite of a value the
 * caller never sent. Every optional is therefore distinguishable by KEY
 * PRESENCE, and the handler branches on `!== undefined` / `in body` rather than
 * on the value.
 */
export const ReschedulePatchSchema = z.object({
    scheduledStartMs: z.number().int().positive()
        .describe('New scheduled start, epoch milliseconds. Authoritative: the civil `date` column is DERIVED from it in the tenant timezone, so the two can never diverge the way a date-only PATCH allowed.'),
    durationMin: z.number().int().min(5).max(1440).optional()
        .describe('New duration in minutes. Omit to preserve the existing booked duration (the end moves with the start).'),
    leadInspectorId: z.string().min(1).nullable().optional()
        .describe('Reassign the lead inspector. null unassigns (the dispatch board drops the card back to the unassigned lane). Omit to leave assignment untouched.'),
    helperInspectorIds: z.array(z.string().min(1)).max(20).optional()
        .describe('Replace the helper list wholesale. Omit to keep the current helpers — this is NOT merged.'),
}).openapi('ReschedulePatch');

const ScheduleConflictSchema = z.object({
    inspectionId: z.string().describe('Colliding inspection id.'),
    propertyAddress: z.string().describe('Colliding inspection address.'),
    date: z.string().describe('Colliding inspection date.'),
    inspectorId: z.string().describe('The assigned inspector the collision belongs to.'),
}).openapi('ScheduleConflict');

export const RescheduleResponseSchema = z.object({
    success: z.boolean().describe('Whether the request succeeded.'),
    data: z.object({
        date: z.string().describe('Stored civil date after the write.'),
        scheduledStartMs: z.number().describe('Stored scheduled start, epoch milliseconds.'),
        scheduledEndMs: z.number().nullable().describe('Stored scheduled end, epoch milliseconds; null when no duration could be resolved.'),
        durationMin: z.number().nullable().describe('Stored duration in minutes; null when unknown.'),
        conflicts: z.array(ScheduleConflictSchema)
            .describe('Overlaps detected for the resulting assignment. Non-empty here means the tenant policy is `advisory` and the write WAS applied; a `block` tenant gets 409 instead.'),
    }).describe('Reschedule result.'),
}).openapi('RescheduleResponse');

export const ScheduleErrorSchema = z.object({
    success: z.boolean().describe('Always false.'),
    error: z.object({
        code: z.string().describe('Machine-readable error code.'),
        message: z.string().describe('Human-readable message.'),
        conflicts: z.array(ScheduleConflictSchema).optional()
            .describe('Present on SCHEDULE_CONFLICT so the caller can render the blocking overlaps without a second round trip.'),
    }).describe('Error payload.'),
}).openapi('ScheduleError');
