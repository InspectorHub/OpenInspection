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

/**
 * The event types the seam carries — `keyof typeof SCHEMAS`, so the registry is
 * the ONE list. Every downstream union in this repo is an `Extract<>` off this
 * type (the three group aliases below), which is what stops a fourth list
 * appearing; see `toCloudEvent` for what happened when one did.
 *
 * ⚠️ Members are the SUFFIX only — `toCloudEvent` adds `io.inspectorhub.`.
 */
export type SyncEventType = keyof typeof SCHEMAS;

/** User-lifecycle third of the seam; types `UserSyncEvent` in lib/integration/user-sync. */
export type UserSyncEventType = Extract<SyncEventType, `user.${string}`>;

/** The command-reply channel (A-21 batch 2/3, P3, CA-03): core's answer to a
 *  portal->core `cmd.*` that asked for a reply. Rides this same sync queue (no
 *  new queue; one consumer per queue). `CmdReplyType` in portal/cmd-reply is an
 *  alias of this — the two lists its old comment warned about are now one. */
export type CmdReplyEventType = Extract<SyncEventType, `reply.${string}`>;

/** Tenant-lifecycle facts that are NOT user events (no user SID involved). */
export type TenantSyncEventType = Extract<SyncEventType, `tenant.${string}`>;

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
const userInvitedDataSchema = z.object({
    tenantId: z.string(),
    email: z.string(),
    role: z.string(),
    passwordHash: z.string(),
    name: z.string().optional(),
});

const userPasswordChangedDataSchema = z.object({
    tenantId: z.string(),
    email: z.string(),
    passwordHash: z.string(),
});

const userDeletedDataSchema = z.object({
    tenantId: z.string(),
    email: z.string(),
});

/** A-21 batch 2 — reply to a portal->core command. `correlationId` is the cmd
 *  envelope id; `replyto` is the producer's routing key
 *  (`wf:onboarding:<instanceId>`) the portal consumer uses to wake the
 *  waiting Workflow instance. `result` is the consumer's terminal verdict —
 *  duplicates re-emit a reply so a lost reply self-heals on command retry. */
const replyTenantUpdatedDataSchema = z.object({
    tenantId: z.string(),
    correlationId: z.string(),
    replyto: z.string(),
    result: z.enum(['applied', 'duplicate', 'stale', 'stale-credential-applied']),
});

/** A-21 batch 3 — export finished: the ZIP is at `r2Key` in the shared
 *  EXPORTS_BUCKET; manifest mirrors DataExportService.ExportManifest. */
const replyTenantExportCompletedDataSchema = z.object({
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
const replyTenantPurgedDataSchema = z.object({
    tenantId: z.string(),
    correlationId: z.string(),
    replyto: z.string(),
    rows: z.number(),
    r2: z.number(),
    r2Bytes: z.number(),
    kv: z.number(),
});

/**
 * Privacy P3 — the COVERAGE DISCLOSURE that rides `reply.subject.erased`.
 *
 * Portal cannot compute this. The erasure catalogue lives in this repo and is
 * not importable across the submodule boundary, so the disclosure exists only if
 * it arrives on the wire — and portal refuses to mark a DSAR `completed` without
 * it, because writing "completed" with nothing behind it is an affirmative claim
 * that everything belonging to the subject was erased.
 *
 * Every field is REQUIRED for the same reason: an optional field is one a future
 * refactor drops without anything going red, and the record silently reverts to
 * a bare "completed".
 *
 * The two halves describe DIFFERENT things and must never be conflated:
 *   - `executedTables` is what THIS RUN actually touched, derived from the run's
 *     own decisions — not from the catalogue, and not from what it could have
 *     reached had there been rows.
 *   - `manifestRuleCount` / `outOfScopeCount` describe the CATALOGUE, a parallel
 *     document rather than the code path that ran. Hence the literal
 *     `catalogueIsAdvisory` flag: a UI cannot present one as the other.
 *   - `pendingRules` are catalogued-but-not-yet-enforced. A flat covered-count
 *     would report them as covered, which is the same false record in a new
 *     place, so the identifiers travel alongside their count.
 *
 * No count is validated against a literal here or on the portal side. Those
 * numbers move whenever the catalogue does; a baked-in expectation would be
 * stale within the month and is precisely the trap this disclosure closes. The
 * one thing asserted is INTERNAL CONSISTENCY — a disclosure whose `pendingRules`
 * and `pendingEnforcementCount` disagree is not a disclosure, so portal refuses
 * it and the reply parks for a human. Builder: `erasure-coverage.ts`.
 */
const coverageDisclosureSchema = z.object({
    manifestRuleCount: z.number(),
    outOfScopeCount: z.number(),
    pendingEnforcementCount: z.number(),
    pendingRules: z.array(z.string()),
    executedTables: z.array(z.string()),
    catalogueIsAdvisory: z.literal(true),
    subjectAxis: z.string(),
}).refine(
    (c) => c.pendingRules.length === c.pendingEnforcementCount,
    { message: 'coverage disclosure is internally inconsistent: pendingRules.length !== pendingEnforcementCount' },
);

/** P3 — the subject SAR ZIP landed at `r2Key` in the shared EXPORTS_BUCKET.
 *  `r2Key` is what core WROTE, not an echo of what it was asked to write. */
const replySubjectExportedDataSchema = z.object({
    tenantId: z.string(),
    correlationId: z.string(),
    replyto: z.string(),
    r2Key: z.string(),
    manifest: z.object({
        rows: z.number(),
        photos: z.number(),
        photosEmbedded: z.union([z.number(), z.boolean()]),
    }),
});

/**
 * P3 — a subject erasure was answered. TWO SHAPES, discriminated by `outcome`.
 *
 * This is the wire declaration of `SubjectErasedReply`
 * (`server/portal/apply-subject-commands.ts`), and it must not say less than
 * that type does. It once did: the applier gained a second ending — a run that
 * executed and PRESERVED the data because a preservation order covers it — and
 * this schema went on describing only the first. Nothing validates a payload
 * against this registry at emit time, so the producer outgrew its own published
 * contract in silence, and the only party that noticed was the consumer, by
 * refusing every held reply that reached it.
 *
 * `coverage` is what a completion is MADE OF, so it lives on the `erased`
 * branch and nowhere else: a preserved run cannot be misread as a completed one
 * by a consumer that reads the payload, because the payload does not contain
 * it. `reason` is required on `held` for the mirror-image reason — it is the
 * sentence the data subject is given, and a held answer without one says "your
 * data was kept" and stops there.
 *
 * There is no third member, and the omission is load-bearing. A run that could
 * not complete — a step that threw, an unreadable holds table — emits NO reply
 * at all: it retries, and an exhausted retry becomes a dead command the console
 * shows. A member here for that ending would give it a shape a reader could
 * mistake for one of the two real answers.
 */
const replySubjectErasedDataSchema = z.discriminatedUnion('outcome', [
    z.object({
        tenantId: z.string(),
        correlationId: z.string(),
        replyto: z.string(),
        outcome: z.literal('erased'),
        anonymizedCount: z.number(),
        deletedCount: z.number(),
        retainedCount: z.number(),
        decisions: z.array(z.unknown()),
        coverage: coverageDisclosureSchema,
    }),
    z.object({
        tenantId: z.string(),
        correlationId: z.string(),
        replyto: z.string(),
        outcome: z.literal('held'),
        /** How many scopes were preserved. Tenant-wide today, so 1 or 0. */
        preserved: z.number(),
        /** The sentence the subject receives, not an internal code. */
        reason: z.string().min(1),
        /** The exception record: what was kept, and on what grounds. */
        decisions: z.array(z.unknown()),
    }),
]);

/**
 * A correction command was answered. TWO SHAPES, discriminated by `outcome`,
 * and the discrimination is the whole point of the schema.
 *
 * The receiver writes an answer against a request that carries a statutory
 * deadline, and only one of these two endings may be recorded as done. So the
 * numbers that make a completion — the version published and the version it
 * supersedes — exist on the `corrected` branch and NOWHERE ELSE, and the
 * sentence a person is owed exists on the `refused` branch and is required
 * there. A refusal therefore cannot be misread as a completion by a consumer
 * reading the payload: it does not contain the thing a completion is made of.
 *
 * There is no third member and there must not be one. A run that neither
 * corrected nor refused — a transient fault — emits no reply at all; it retries
 * and, on exhaustion, becomes a visible dead command. Any value here would be
 * read as one of the two answers above.
 */
const replyReportCorrectedDataSchema = z.discriminatedUnion('outcome', [
    z.object({
        tenantId: z.string(),
        correlationId: z.string(),
        replyto: z.string(),
        inspectionId: z.string(),
        field: z.string(),
        outcome: z.literal('corrected'),
        versionNumber: z.number(),
        supersedes: z.number(),
    }),
    z.object({
        tenantId: z.string(),
        correlationId: z.string(),
        replyto: z.string(),
        inspectionId: z.string(),
        field: z.string(),
        outcome: z.literal('refused'),
        /** The refusal in its own words. Required — a refusal with no stated
         *  ground is indistinguishable from a request nobody looked at. */
        reason: z.string().min(1),
    }),
]);

/**
 * Core-managed messaging-compliance state (10DLC brand/campaign, toll-free
 * verification) crossing to portal, which renders it read-only.
 *
 * `complianceStatus` is `z.string()` and not an enum on purpose: the vocabulary
 * is the upstream carrier's, and portal already logs-and-stores an unrecognised
 * value rather than rejecting it — an enum here would make the producer stricter
 * than the consumer, backwards for a tolerant-reader seam. `rejectionReason` is
 * nullable because an approval has no reason and `undefined` is dropped by
 * JSON.stringify, turning an explicit "no reason" into a missing key.
 */
const tenantComplianceStatusUpdatedDataSchema = z.object({
    tenantId: z.string(),
    complianceStatus: z.string(),
    rejectionReason: z.string().nullable(),
    /** Epoch SECONDS — both emitters divide by 1000. */
    updatedAt: z.number(),
});

/**
 * Registry of supported dataschema versions per event type, and the single
 * declaration of what the seam carries: registering a type here is what makes it
 * nameable. Portal's `isKnown(type, dataschema)` consults its equivalent; a
 * version absent there parks rather than 400s on the consumer side.
 *
 * ⚠️ KEYS ARE UNPREFIXED. `toCloudEvent` prepends `io.inspectorhub.` and the
 * dataschema is this key kebab-cased, while portal's `KNOWN_TYPES` is keyed by
 * the PREFIXED wire type — so a key here must equal portal's minus the prefix.
 */
export const SCHEMAS = {
    'user.invited': ['v1'],
    'user.password_changed': ['v1'],
    'user.deleted': ['v1'],
    'reply.tenant.updated': ['v1'],
    'reply.tenant.export_completed': ['v1'],
    'reply.tenant.purged': ['v1'],
    'reply.subject.exported': ['v1'],
    'reply.subject.erased': ['v1'],
    'reply.report.corrected': ['v1'],
    // Core-managed 10DLC/TFV messaging-compliance state. Portal keeps a
    // read-only snapshot; core is the source of truth.
    'tenant.compliance_status_updated': ['v1'],
} as const satisfies Record<string, readonly string[]>;

/** Zod validator per event type, for tests and producer-side assertions. */
export const DATA_SCHEMAS: Record<SyncEventType, z.ZodTypeAny> = {
    'user.invited': userInvitedDataSchema,
    'user.password_changed': userPasswordChangedDataSchema,
    'user.deleted': userDeletedDataSchema,
    'reply.tenant.updated': replyTenantUpdatedDataSchema,
    'reply.tenant.export_completed': replyTenantExportCompletedDataSchema,
    'reply.tenant.purged': replyTenantPurgedDataSchema,
    'reply.subject.exported': replySubjectExportedDataSchema,
    'reply.subject.erased': replySubjectErasedDataSchema,
    'reply.report.corrected': replyReportCorrectedDataSchema,
    'tenant.compliance_status_updated': tenantComplianceStatusUpdatedDataSchema,
};

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

/** Is this stored `event_type` one the registry knows? A type predicate rather
 *  than a cast, because the value genuinely arrives as `string` — it is a D1
 *  column — so checking is the only honest route to `SyncEventType`. */
export function isRegisteredEventType(eventType: string): eventType is SyncEventType {
    return Object.prototype.hasOwnProperty.call(SCHEMAS, eventType);
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
            + '(register it in SCHEMAS/DATA_SCHEMAS in lib/sync-events/envelope.ts; '
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
