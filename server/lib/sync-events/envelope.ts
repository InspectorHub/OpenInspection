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

import {
    SCHEMAS,
    DATA_SCHEMAS,
    isRegisteredEventType,
    type SyncEventType,
} from './registry';

// Re-exported so every existing importer keeps one address for the seam. The
// registry moved to its own module when this file crossed the size gate; what
// the seam CARRIES and how it is SERIALIZED are different questions, and only
// the second one is left here.
export { SCHEMAS, DATA_SCHEMAS, isRegisteredEventType };
export type { SyncEventType };

// The group aliases. Every one is an `Extract<>` off `SyncEventType`, which is
// `keyof typeof SCHEMAS` — that is what stops a fourth hand-written list of
// event names appearing. See `toCloudEvent` below for what happened when one did.

/** User-lifecycle third of the seam; types `UserSyncEvent` in lib/integration/user-sync. */
export type UserSyncEventType = Extract<SyncEventType, `user.${string}`>;

/** The command-reply channel (A-21 batch 2/3, P3, CA-03): core's answer to a
 *  portal->core `cmd.*` that asked for a reply. Rides this same sync queue (no
 *  new queue; one consumer per queue). `CmdReplyType` in portal/cmd-reply is an
 *  alias of this — the two lists its old comment warned about are now one. */
export type CmdReplyEventType = Extract<SyncEventType, `reply.${string}`>;

/** Tenant-lifecycle facts that are NOT user events (no user SID involved). */
export type TenantSyncEventType = Extract<SyncEventType, `tenant.${string}`>;

/** Import-run facts the DEPLOYMENT OPERATOR needs, as opposed to the workspace.
 *  Everything else on an import run is told to the workspace by email; this
 *  family is the other direction, and it exists because nothing used to travel
 *  it at all. */
export type MigrationSyncEventType = Extract<SyncEventType, `migration.${string}`>;

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


/** `user.invited` -> `user-invited`, `user.password_changed` ->
 *  `user-password-changed`. Dots AND underscores become dashes — the
 *  dataschema segment is fully kebab-case (matches the golden fixtures and
 *  portal's KNOWN_TYPES registry). */
function kebabEventName(eventType: string): string {
    return eventType.replace(/[._]/g, '-');
}

/** Build the `dataschema` for an event type at v1 (the only version today). */
function dataschemaFor(eventType: string, version = 'v1'): string {
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
 *
 * THROWS on an unregistered event type. This line used to be
 * `row.eventType as SyncEventType`, and that cast is the whole reason
 * `tenant.compliance_status_updated` shipped broken: the outbox service kept its
 * own hand-written union holding the ALREADY-PREFIXED name, the cast waved it
 * past the template literal, and every such event reached the queue as
 * `io.inspectorhub.io.inspectorhub.tenant.…` with a matching junk dataschema.
 * Portal knew neither, so it parked them all — silently, because parking IS the
 * designed answer to an unknown type, and nothing distinguishes "a producer we
 * have not taught it yet" from "a name that cannot exist".
 *
 * Throwing is the loud version of the same refusal, and it lands where someone
 * looks: both callers (inline waitUntil publish, cron sweeper) catch and leave
 * the row `pending`, so `counts().oldestPendingAge` climbs and the sync-health
 * badge lights. The producer side is fenced at compile time (`OutboxEvent`
 * derives from `SyncEventType`), so reaching this throw means a row that
 * predates the fence — exactly the case worth seeing.
 */
export function toCloudEvent(row: OutboxRowLike): SyncEnvelope {
    if (!isRegisteredEventType(row.eventType)) {
        throw new Error(
            `[sync] refusing to serialize unregistered event type "${row.eventType}" `
            + '(register it in SCHEMAS/DATA_SCHEMAS in lib/sync-events/registry.ts; '
            + 'note the keys there are UNPREFIXED — toCloudEvent adds io.inspectorhub.)',
        );
    }
    return {
        specversion: '1.0',
        id: row.id,
        type: `io.inspectorhub.${row.eventType}`,
        source: 'core',
        time: row.createdAt.toISOString(),
        dataschema: dataschemaFor(row.eventType),
        data: JSON.parse(row.payload) as Record<string, unknown>,
    };
}
