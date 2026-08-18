/**
 * The migration-intake vocabulary — a PURE TYPE MODULE.
 *
 * Zero runtime dependency on drizzle or hono, deliberately: the adapters and
 * the staging schema both take their words from here, so the vocabulary exists
 * once rather than being spelled twice and drifting.
 *
 * Task 2 extends this file with `MigrationBundleV1` and its sub-types; this
 * block is what the staging schema needs and Task 2 does not change it.
 */
export const MIGRATION_ENTITY_KINDS = ['template', 'contact', 'member'] as const;
export type EntityKind = typeof MIGRATION_ENTITY_KINDS[number];
