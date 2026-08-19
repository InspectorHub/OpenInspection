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
  // We looked at the file and concluded it could not be converted, and said so.
  // Distinct from `abandoned` for the same reason `partially_applied` is
  // distinct from `applied`: the two outcomes have opposite responsible
  // parties, and a column that records both as one value is, on this point, not
  // a status column.
  'declined',
  // A run whose file no adapter could read. It is a STATE, not a dead end: the
  // file stays where it was put, and the run resumes as a normal staged batch
  // once somebody has converted it. Modelling it as a status rather than as an
  // error is what gives the operator something with an id they can come back to.
  'needs_assistance',
  // Reached its own expiry without ever being converted. Distinct from
  // `abandoned`, which is what an untouched STAGED run becomes: abandoned means
  // the operator stopped, expired means we did.
  'expired',
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
  DECLINED: 'declined',
  NEEDS_ASSISTANCE: 'needs_assistance',
  EXPIRED: 'expired',
} as const satisfies Record<string, MigrationBatchStatus>;
