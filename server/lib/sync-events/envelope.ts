// CloudEvents 1.0 profile for the core -> portal user-sync seam (A-13).
//
// This module is the contract layer: it turns a raw `sync_outbox` row into a
// CloudEvents envelope that the portal consumer parses. It lives OUTSIDE
// server/portal/ on purpose so the DI container (server/lib/middleware/di.ts)
// and the scheduled sweeper can import it without breaching the portal
// isolation gate. It carries NO portal-specific knowledge — only the wire
// shape that both repos agree on via golden fixtures.
//
// Versioning rule (the actual A-13 contract):
//   - `type` is stable and never carries the version
//     (e.g. `io.inspectorhub.user.invited`).
//   - `dataschema` carries the version as `<kebab-event-name>/v<N>`
//     (e.g. `user-invited/v1`, `user-password-changed/v1`).
//   - Additive optional fields in `data` do NOT bump the version; consumers
//     ignore unknown fields and default missing optionals (tolerant reader).
//   - Breaking changes mint a new `dataschema` version.

import { z } from 'zod';

/** The event types the seam carries. The three user-lifecycle events mirror
 *  `UserSyncEventType` in lib/integration/user-sync (kept independent so this
 *  contract module has no dependency on the outbox service surface).
 *  `reply.tenant.updated` (A-21 batch 2) is the command-reply channel: core's
 *  answer to a portal->core `cmd.tenant.update` that asked for a reply — it
 *  rides this same sync queue (no new queue; one consumer per queue). */
export type SyncEventType =
    | 'user.invited'
    | 'user.password_changed'
    | 'user.deleted'
    | 'reply.tenant.updated'
    | 'reply.tenant.export_completed'
    | 'reply.tenant.purged';

/** CloudEvents 1.0 envelope (subset profile used by this seam). */
export interface SyncEnvelope {
    specversion: '1.0';
    /** Dedup key = the originating `sync_outbox.id`. */
    id: string;
    /** Stable reverse-DNS event type; never carries the version. */
    type: `io.inspectorhub.${SyncEventType}`;
    /** Producer identity — always `core` for this seam. */
    source: 'core';
    /** ISO-8601 timestamp = the outbox row's `created_at`. */
    time: string;
    /** Version carrier: `<kebab-event-name>/v<N>`. */
    dataschema: string;
    /** Event-specific payload (validated by the per-type Zod schema). */
    data: Record<string, unknown>;
}

/** Zod schemas for each event's `data` shape. Tolerant readers: additive
 *  optional fields are allowed without a version bump, so these do NOT use
 *  `.strict()`. */
export const userInvitedDataSchema = z.object({
    tenantId: z.string(),
    email: z.string(),
    role: z.string(),
    passwordHash: z.string(),
    name: z.string().optional(),
});

export const userPasswordChangedDataSchema = z.object({
    tenantId: z.string(),
    email: z.string(),
    passwordHash: z.string(),
});

export const userDeletedDataSchema = z.object({
    tenantId: z.string(),
    email: z.string(),
});

/** A-21 batch 2 — reply to a portal->core command. `correlationId` is the cmd
 *  envelope id; `replyto` is the producer's routing key
 *  (`wf:onboarding:<instanceId>`) the portal consumer uses to wake the
 *  waiting Workflow instance. `result` is the consumer's terminal verdict —
 *  duplicates re-emit a reply so a lost reply self-heals on command retry. */
export const replyTenantUpdatedDataSchema = z.object({
    tenantId: z.string(),
    correlationId: z.string(),
    replyto: z.string(),
    result: z.enum(['applied', 'duplicate', 'stale', 'stale-credential-applied']),
});

/** A-21 batch 3 — export finished: the ZIP is at `r2Key` in the shared
 *  EXPORTS_BUCKET; manifest mirrors DataExportService.ExportManifest. */
export const replyTenantExportCompletedDataSchema = z.object({
    tenantId: z.string(),
    correlationId: z.string(),
    replyto: z.string(),
    r2Key: z.string(),
    manifest: z.object({
        rows: z.number(),
        photos: z.number(),
        photosEmbedded: z.number(),
    }),
});

/** A-21 batch 3 — purge finished: destruction counts (A-20 compliance; core
 *  also keeps the durable tenant_destruction_records row). */
export const replyTenantPurgedDataSchema = z.object({
    tenantId: z.string(),
    correlationId: z.string(),
    replyto: z.string(),
    rows: z.number(),
    r2: z.number(),
    r2Bytes: z.number(),
    kv: z.number(),
});

export type UserInvitedData = z.infer<typeof userInvitedDataSchema>;
export type UserPasswordChangedData = z.infer<typeof userPasswordChangedDataSchema>;
export type UserDeletedData = z.infer<typeof userDeletedDataSchema>;
export type ReplyTenantUpdatedData = z.infer<typeof replyTenantUpdatedDataSchema>;
export type ReplyTenantExportCompletedData = z.infer<typeof replyTenantExportCompletedDataSchema>;
export type ReplyTenantPurgedData = z.infer<typeof replyTenantPurgedDataSchema>;

/** Registry mapping each event type to its supported dataschema versions.
 *  Portal's `isKnown(type, dataschema)` consults the equivalent registry; a
 *  version absent here parks rather than 400s on the consumer side. */
export const SCHEMAS: Record<SyncEventType, readonly string[]> = {
    'user.invited': ['v1'],
    'user.password_changed': ['v1'],
    'user.deleted': ['v1'],
    'reply.tenant.updated': ['v1'],
    'reply.tenant.export_completed': ['v1'],
    'reply.tenant.purged': ['v1'],
};

/** Zod validator per event type, for tests and producer-side assertions. */
export const DATA_SCHEMAS: Record<SyncEventType, z.ZodTypeAny> = {
    'user.invited': userInvitedDataSchema,
    'user.password_changed': userPasswordChangedDataSchema,
    'user.deleted': userDeletedDataSchema,
    'reply.tenant.updated': replyTenantUpdatedDataSchema,
    'reply.tenant.export_completed': replyTenantExportCompletedDataSchema,
    'reply.tenant.purged': replyTenantPurgedDataSchema,
};

/** `user.invited` -> `user-invited`, `user.password_changed` ->
 *  `user-password-changed`. Dots AND underscores become dashes — the
 *  dataschema segment is fully kebab-case (matches the golden fixtures and
 *  portal's KNOWN_TYPES registry). */
function kebabEventName(eventType: string): string {
    return eventType.replace(/[._]/g, '-');
}

/** Build the `dataschema` for an event type at v1 (the only version today). */
export function dataschemaFor(eventType: string, version = 'v1'): string {
    return `${kebabEventName(eventType)}/${version}`;
}

/** Minimal outbox-row view this module needs to build an envelope. Decoupled
 *  from `OutboxRow` so the contract module does not depend on the service. */
export interface OutboxRowLike {
    id: string;
    eventType: string;
    /** JSON-encoded payload string (as stored in `sync_outbox.payload`). */
    payload: string;
    /** Epoch ms (as stored in `sync_outbox.created_at`). */
    createdAt: Date;
}

/**
 * Serialize a raw outbox row into a CloudEvents envelope. The `id` and `time`
 * come straight from the row so the round-trip is exact (golden-fixture
 * contract tests rely on this determinism).
 */
export function toCloudEvent(row: OutboxRowLike): SyncEnvelope {
    return {
        specversion: '1.0',
        id: row.id,
        type: `io.inspectorhub.${row.eventType as SyncEventType}`,
        source: 'core',
        time: row.createdAt.toISOString(),
        dataschema: dataschemaFor(row.eventType),
        data: JSON.parse(row.payload) as Record<string, unknown>,
    };
}
