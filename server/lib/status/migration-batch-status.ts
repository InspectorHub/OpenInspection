/**
 * Single source of truth for the MIGRATION BATCH lifecycle axis.
 *
 * A DIFFERENT axis from the per-row one next door, and the collision is why
 * both files exist: a batch's `applied` means "every row was consumed", a
 * row's `applied` means "this one row reached the real table". No consumer of
 * one may reach for the other's constant and still typecheck.
 *
 * `partially_applied` is not a nicety. A run with any failed row is not an
 * applied run, and a status column that records it as one is a status column
 * that has stopped answering the question it exists for.
 *
 * Every consumer (drizzle enum, service writes, queries) MUST derive from
 * these — no bare status string literals.
 */
export const MIGRATION_BATCH_STATUSES = [
  'staged',
  'applying',
  'applied',
  'partially_applied',
  'reverted',
  'partially_reverted',
  'abandoned',
] as const;

export type MigrationBatchStatus = typeof MIGRATION_BATCH_STATUSES[number];

export const MIGRATION_BATCH_STATUS = {
  STAGED: 'staged',
  APPLYING: 'applying',
  APPLIED: 'applied',
  PARTIALLY_APPLIED: 'partially_applied',
  REVERTED: 'reverted',
  PARTIALLY_REVERTED: 'partially_reverted',
  ABANDONED: 'abandoned',
} as const satisfies Record<string, MigrationBatchStatus>;
