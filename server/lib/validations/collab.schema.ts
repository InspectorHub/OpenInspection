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

export type CollabRestoreRequest = z.infer<typeof CollabRestoreRequestSchema>;

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
