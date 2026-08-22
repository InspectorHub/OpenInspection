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
    | 'reply.tenant.purged'
    | 'reply.subject.exported'
    | 'reply.subject.erased'
    | 'reply.report.corrected';

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
    'reply.subject.exported': ['v1'],
    'reply.subject.erased': ['v1'],
    'reply.report.corrected': ['v1'],
};

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
