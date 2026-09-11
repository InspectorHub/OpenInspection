/**
 * Validation schemas for the collaborative-editing snapshot/restore routes
 * (#181 Phase 4 — server/api/inspections/collab.ts).
 *
 * Repo rule: every endpoint that accepts user input validates via a Zod schema
 * that lives in this validations module (never inline in the handler).
 */
import { z } from '@hono/zod-openapi';

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
