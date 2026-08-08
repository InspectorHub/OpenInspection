import { z } from '@hono/zod-openapi';

/**
 * GDPR Art. 21 — a report recipient's objection to view measurement.
 *
 * One boolean, because the right is one decision. `objected: false` withdraws
 * a previous objection; the recipient who changed their mind is entitled to
 * that, and modelling it as a separate DELETE would be a second surface to
 * forget. See docs/compliance/report-view-lia.md condition 9.
 */
export const ViewTrackingObjectionBodySchema = z.object({
    objected: z.boolean().describe('true records an objection (the counter stops); false withdraws it.'),
});

export const ViewTrackingStateSchema = z.object({
    objected: z.boolean().describe('Whether this recipient has objected to view measurement.'),
    objectedAt: z.string().nullable().describe('ISO timestamp of the objection, or null. An objection has a date; a boolean alone throws that away.'),
});
