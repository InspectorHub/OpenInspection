/**
 * Single source of truth for the DESTRUCTION-RECORD axis — whether a tenant
 * purge got as far as saying it finished.
 *
 * Two states and no more. `started` is written before anything is destroyed;
 * `completed` is written after every step has run, together with the counts.
 * There is deliberately no `failed`: a purge cannot report its own failure,
 * because the failures worth recording are the ones that stop it running at
 * all. Absence of `completed` IS the failure signal, and it survives a crash
 * in a way a status write never could.
 *
 * See `docs/compliance/destruction-evidence.md`.
 */
export const DESTRUCTION_STATUSES = ['started', 'completed'] as const;

export type DestructionStatus = typeof DESTRUCTION_STATUSES[number];

export const DESTRUCTION_STATUS = {
  STARTED: 'started',
  COMPLETED: 'completed',
} as const satisfies Record<string, DestructionStatus>;

export function isDestructionStatus(value: unknown): value is DestructionStatus {
  return typeof value === 'string' && (DESTRUCTION_STATUSES as readonly string[]).includes(value);
}
