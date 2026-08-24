import { z } from 'zod';

/**
 * WHAT THE SEAM CARRIES — the registry, and the per-event `data` shapes.
 *
 * Split out of `envelope.ts` when that file crossed the 400-line gate. The two
 * halves answer different questions and the boundary is on that line, not on
 * the line count: THIS file says which events exist and what each one's payload
 * looks like; `envelope.ts` says how any of them is turned into bytes on the
 * wire.
 *
 * ⚠️ IT IS STILL ONE LIST. `SCHEMAS` below is the single declaration of what the
 * seam carries — `SyncEventType` is `keyof typeof SCHEMAS`, every downstream
 * union is an `Extract<>` off that, and `DATA_SCHEMAS` is keyed by it so a
 * registered type with no validator is a compile error. A second list of event
 * names anywhere is the defect that was removed when a hand-written union in
 * the outbox service drifted into an already-prefixed spelling and every event
 * of that type reached the queue as `io.inspectorhub.io.inspectorhub.…`.
 */

/**
 * The event types the seam carries.
 *
 * ⚠️ Members are the SUFFIX only — `toCloudEvent` adds `io.inspectorhub.`.
 */
export type SyncEventType = keyof typeof SCHEMAS;

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
 * An import run has stopped and is waiting for a person at the deployment
 * operator to open its file and convert it by hand.
 *
 * ── Why an event rather than a query ────────────────────────────────────────
 * Everything else this pipeline sends goes to the WORKSPACE — "we received your
 * file", "it is ready", "it is about to expire". Nothing went the other way, so
 * the only way for the operator to discover a waiting run was to go looking for
 * one. This event is the other direction, and it is also what lets an operator
 * console list waiting runs without a cross-service query on every page load.
 *
 * ── Why `expiresAt` is on it ────────────────────────────────────────────────
 * A waiting run has a deadline, and a console that shows the queue without the
 * clock makes "nobody looked" indistinguishable from "nothing is due". The
 * number is EPOCH MILLISECONDS, matching the column it is read from — the
 * sibling tenant event carries SECONDS, which is exactly the kind of quiet
 * disagreement a golden fixture exists to pin.
 *
 * ── Why `vendor` is nullable, and not a guess ───────────────────────────────
 * Nothing has read this file. What may be carried is the operator's OWN
 * declaration of where the export came from; where they could not name one —
 * the entry point for "I have an export and do not know what it is" — this is
 * null. The stored row carries a placeholder vendor for schema reasons, and
 * putting that on the wire would publish a guess as a fact.
 *
 * ── Why `secondaryUseAuthorised` travels with the event ─────────────────────
 * The console has to SHOW it, and reading it later would be a second
 * cross-service call for something that was already true when this was written.
 * See `secondaryUseAuthorisedFor` in services/migration-intake/staff-access.ts
 * for what it can be and why.
 */
const migrationAssistanceRequestedDataSchema = z.object({
    tenantId: z.string(),
    batchId: z.string(),
    /** The operator's own declaration, or null when they could not name one. */
    vendor: z.string().nullable(),
    /** Epoch MILLISECONDS — when the file arrived. */
    uploadedAt: z.number(),
    /** Epoch MILLISECONDS — when the file and the run stop being kept. */
    expiresAt: z.number(),
    /** Whether anything authorises using the file's contents beyond this run. */
    secondaryUseAuthorised: z.boolean(),
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
    // A run whose file nothing could read is waiting for a person at the
    // deployment operator. The one event on this seam addressed to THEM.
    'migration.assistance_requested': ['v1'],
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
    'migration.assistance_requested': migrationAssistanceRequestedDataSchema,
};

/** Is this stored `event_type` one the registry knows? A type predicate rather
 *  than a cast, because the value genuinely arrives as `string` — it is a D1
 *  column — so checking is the only honest route to `SyncEventType`. */
export function isRegisteredEventType(eventType: string): eventType is SyncEventType {
    return Object.prototype.hasOwnProperty.call(SCHEMAS, eventType);
}
