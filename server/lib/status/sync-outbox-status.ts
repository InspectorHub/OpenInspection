/**
 * Single source of truth for the SYNC OUTBOX (core -> portal delivery) axis.
 *
 * This is a DIFFERENT axis from `REPORT_STATUS`, and the collision is the whole
 * reason this file exists: an outbox row's `published` means "handed to the
 * queue", while a report's `published` means "delivered to the client". They
 * share one English word and nothing else — no consumer of one should ever be
 * able to reach for the other's constant and typecheck.
 *
 * State machine (spec 6): pending -> published (terminal happy path). `failed`
 * is set ONLY by the DLQ writeback. Legacy `done` rows are treated as terminal
 * and ignored by the sweeper — deliberately absent here, since nothing may
 * WRITE it.
 *
 * Every consumer (drizzle enum, service writes, queries) MUST derive from these
 * — no bare status string literals.
 */
export const SYNC_OUTBOX_STATUSES = ['pending', 'published', 'failed'] as const;

type SyncOutboxStatus = typeof SYNC_OUTBOX_STATUSES[number];

export const SYNC_OUTBOX_STATUS = {
  PENDING: 'pending',
  PUBLISHED: 'published',
  FAILED: 'failed',
} as const satisfies Record<string, SyncOutboxStatus>;
