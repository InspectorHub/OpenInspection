/**
 * Single source of truth for the MIGRATION ROW outcome axis.
 *
 * `skipped` and `failed` are deliberately separate: a skip is a decision the
 * operator made (the target already existed), a failure is something that went
 * wrong. Collapsing them would make an import report that a conflict was an
 * error, and an error a routine conflict.
 *
 * `reverted` exists so a partially reverted batch stays readable row by row.
 * Without it, a row that was undone and a row whose undo was REFUSED both read
 * as `applied`, and the refusal list could only be reconstructed by guessing.
 *
 * Every consumer (drizzle enum, service writes, queries) MUST derive from
 * these — no bare status string literals.
 */
export const MIGRATION_ROW_STATUSES = [
  'pending',
  'applied',
  'skipped',
  'failed',
  'reverted',
] as const;

export type MigrationRowStatus = typeof MIGRATION_ROW_STATUSES[number];

export const MIGRATION_ROW_STATUS = {
  PENDING: 'pending',
  APPLIED: 'applied',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  REVERTED: 'reverted',
} as const satisfies Record<string, MigrationRowStatus>;
