/**
 * Single source of truth for the INSPECTION (appointment/event) lifecycle axis.
 * Mirrors server/lib/auth/roles.ts. Every consumer (drizzle enum, Zod enum,
 * UI labels, filters) MUST derive from these — no bare status string literals.
 */
export const INSPECTION_STATUSES = [
  'requested', 'scheduled', 'confirmed', 'completed', 'cancelled',
] as const;

export type InspectionStatus = typeof INSPECTION_STATUSES[number];

export const INSPECTION_STATUS = {
  REQUESTED: 'requested',
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const satisfies Record<string, InspectionStatus>;

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function isInspectionStatus(value: unknown): value is InspectionStatus {
  return typeof value === 'string' && (INSPECTION_STATUSES as readonly string[]).includes(value);
}
