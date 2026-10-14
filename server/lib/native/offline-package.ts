/**
 * Offline data package, format v1.
 *
 * A package is a zip a device writes when it cannot sync (or a member hands to a
 * colleague): the Yjs state of each inspection it worked on, the writes it
 * queued, and the photos it captured. Another member can import it.
 *
 * Everything in a package is a claim made by whoever produced it. None of it is
 * trusted for authority: the tenant and the importing identity come from the
 * verified session, `exportedBy` is recorded for the audit trail and is never
 * consulted for authorization, and every inspection the package names is checked
 * against the importer's own permissions before anything is written.
 *
 * Strictness, deliberately uneven:
 *  - the manifest and media index ignore unknown keys, so a later writer may add
 *    fields within version 1 without breaking an older server;
 *  - an outbox entry's envelope is strict, because `op` selects what the server
 *    will execute and an unknown envelope key is a format error, not a hint;
 *  - an outbox payload keeps its extra keys, which the target route's own schema
 *    then validates when the write is replayed.
 */

import { z } from '@hono/zod-openapi';
import { IMPORT_LIMIT_CEILINGS } from './import-limits';

const OFFLINE_PACKAGE_FORMAT = 'openinspection-offline-package';

/**
 * The shape every identifier in a package must have. The repository forbids
 * validating ids as UUIDs (ids are not always UUIDs); what matters here is that
 * an id can never smuggle a path separator, a dot segment or whitespace into a
 * zip entry name, an R2 key or a header.
 */
export const OFFLINE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const IdSchema = z.string().regex(OFFLINE_ID_PATTERN);

/** An idempotency key travels in a header, so it is limited to header-safe characters. */
const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);

/**
 * Most inspections, queued writes and media entries any package may carry. These
 * are the absolute ceilings; the limit an import enforces is the deployment's own
 * (`readImportLimits`), which is never above them and is checked first, so a
 * package that is merely over the configured limit gets 422 PACKAGE_TOO_LARGE
 * rather than a format error.
 */
const MAX_PACKAGE_INSPECTIONS = IMPORT_LIMIT_CEILINGS.inspections;
const MAX_OUTBOX_ENTRIES = IMPORT_LIMIT_CEILINGS.outbox;
const MAX_MEDIA_ENTRIES = IMPORT_LIMIT_CEILINGS.photos;

export const OfflinePackageManifestSchema = z.object({
    format: z.literal(OFFLINE_PACKAGE_FORMAT),
    version: z.literal(1),
    tenantId: IdSchema,
    deviceId: z.string().min(1).max(128),
    exportedBy: IdSchema,
    exportedAt: z.string().datetime(),
    inspections: z.array(z.object({ id: IdSchema, reportId: z.string().min(1).max(128) }))
        .min(1)
        .max(MAX_PACKAGE_INSPECTIONS)
        .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, { message: 'duplicate inspection id' }),
});
export type OfflinePackageManifest = z.infer<typeof OfflinePackageManifestSchema>;

/** The writes a package may replay. Anything else is refused, not skipped. */
const OUTBOX_OPS = ['inspection.create', 'inspection.update', 'inspection.complete'] as const;

/**
 * One queued write. `payload.id` names the inspection it concerns (for a
 * create, the id the client chose); for an update the remaining payload keys are
 * the patch.
 */
export const OutboxEntrySchema = z.strictObject({
    idempotencyKey: IdempotencyKeySchema,
    op: z.enum(OUTBOX_OPS),
    payload: z.looseObject({ id: IdSchema }),
});
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>;

export const OutboxSchema = z.array(OutboxEntrySchema)
    .max(MAX_OUTBOX_ENTRIES)
    .refine((rows) => new Set(rows.map((r) => r.idempotencyKey)).size === rows.length, { message: 'duplicate idempotency key' });

const MEDIA_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/heic'] as const;

export const MediaIndexSchema = z.array(z.object({
    pendingId: IdSchema,
    inspectionId: IdSchema,
    contentType: z.enum(MEDIA_CONTENT_TYPES),
}))
    .max(MAX_MEDIA_ENTRIES)
    .refine((rows) => new Set(rows.map((r) => r.pendingId)).size === rows.length, { message: 'duplicate pending id' });
export type MediaIndex = z.infer<typeof MediaIndexSchema>;
