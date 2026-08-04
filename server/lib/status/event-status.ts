/**
 * Single source of truth for the INSPECTION EVENT (visit) lifecycle axis.
 *
 * This is a DIFFERENT axis from `INSPECTION_STATUS`, which tracks the order as a
 * whole. A radon test is two visits against one inspection — a drop-off and a
 * pickup — so an event reaches `completed` while its inspection is still
 * `confirmed`, and `results_received` has no counterpart on the order at all.
 * Sharing one enum between the two would make every consumer decide which axis a
 * bare `'completed'` belongs to, which is the ambiguity this file removes.
 *
 * Every consumer (drizzle enum, Zod enum, UI labels, action gating) MUST derive
 * from these — no bare status string literals, enforced by `lint:status-literals`.
 */
export const EVENT_STATUSES = [
  'scheduled', 'completed', 'results_received', 'cancelled',
] as const;

export type EventStatus = typeof EVENT_STATUSES[number];

export const EVENT_STATUS = {
  SCHEDULED:        'scheduled',
  COMPLETED:        'completed',
  RESULTS_RECEIVED: 'results_received',
  CANCELLED:        'cancelled',
} as const satisfies Record<string, EventStatus>;
