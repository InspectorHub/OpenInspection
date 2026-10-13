/**
 * Validation schemas for the collaborative-editing snapshot/restore routes
 * (#181 Phase 4 — server/api/inspections/collab.ts).
 *
 * Repo rule: every endpoint that accepts user input validates via a Zod schema
 * that lives in this validations module (never inline in the handler).
 */
import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Body of `POST /:id/collab/restore` — the snapshot `seq` to restore to.
 *
 * `seq` is a non-negative integer (snapshot sequence numbers start at 0 and
 * only increase). Restore is fail-closed on an unknown seq (404 from the DO),
 * so this schema guards only the shape, not existence.
 */
export const CollabRestoreRequestSchema = z.object({
    seq: z.number().int().nonnegative(),
}).openapi('CollabRestoreRequest');

/**
 * Body of `POST /:id/collab/followup` — one carried item's follow-up verdict.
 *
 * `status` is a STATUS KEY from the workspace's re-inspection status set, and
 * this schema deliberately does not enumerate them: the set is per-tenant
 * (`tenant_configs.reinspection_statuses`, defaults in
 * `server/lib/reinspection-status.ts`), so membership is checked by the handler
 * against the tenant's own list rather than baked in here. `null` is valid and
 * means "no conclusion recorded" — the state a carried item starts in, so
 * clearing an answer has to be expressible.
 *
 * `notes` is optional and ABSENT means "leave the note alone"; an empty string
 * clears it. Recording a status must not silently erase a note.
 */
export const CollabFollowupRequestSchema = z.object({
    itemId: z.string().min(1),
    status: z.string().min(1).nullable(),
    notes:  z.string().max(4000).optional(),
}).openapi('CollabFollowupRequest');

/**
 * Path param of `GET /:id/collab/snapshots/:seq` — the snapshot `seq` to fetch.
 *
 * The path segment arrives as a string; `coerce` parses it and the int /
 * non-negative guards reject anything that is not a valid sequence number
 * (snapshot seqs start at 0 and only increase). Fetch is fail-closed on an
 * unknown seq (404 from the DO), so this schema guards only the shape.
 */
export const CollabSnapshotParamSchema = z.object({
    seq: z.coerce.number().int().nonnegative(),
});

/** Path param of `POST /:id/collab/ticket` — the inspection the socket will open. */
export const CollabTicketParamSchema = z.object({
    id: z.string().trim().min(1).describe('Inspection the one-time WebSocket ticket is issued for'),
});

/** Response of `POST /:id/collab/ticket` — an opaque single-use credential. */
export const CollabTicketResponseSchema = createApiResponseSchema(z.object({
    ticket: z.string().describe('Opaque one-time ticket to pass as the ticket query parameter of the WebSocket URL'),
    expiresIn: z.number().int().describe('Seconds the ticket stays valid'),
}));

/** What the Durable Object answers when an offline update was applied and persisted. */
export const CollabImportResultSchema = z.object({
    ok: z.literal(true),
    snapshotSeq: z.number().int().nonnegative().describe('Sequence number of the snapshot taken just before the import'),
});
