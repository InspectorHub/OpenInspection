import { z } from 'zod';
import { AUTHORITY_BASES } from '../auth/authority-basis';
import { CORRECTABLE_FIELDS } from '../validations/correction.schema';

/**
 * Consumer-side contract for the portal -> core COMMAND seam (A-21 batch 1).
 * Mirror of the sync seam's tolerant-reader rules (see envelope.ts in this
 * directory): stable `type`, `dataschema` carries the version, unknown
 * type/version PARKS (never 400s/retries). Lives in lib/sync-events (outside
 * server/portal/) for the same isolation-gate reason as envelope.ts.
 * `tenantseq` is REQUIRED: the per-tenant monotonic sequence used by the
 * stale-command guard (`tenants.applied_cmd_seq`).
 */

const KNOWN_CMD_TYPES: Record<string, readonly string[]> = {
    'io.inspectorhub.cmd.tenant.update': ['cmd-tenant-update/v1'],
    'io.inspectorhub.cmd.tenant.sync_quota': ['cmd-tenant-sync-quota/v1'],
    'io.inspectorhub.cmd.tenant.seed_starter_content': ['cmd-tenant-seed-starter-content/v1'],
    // A-21 batch 3 — offboarding data plane.
    'io.inspectorhub.cmd.tenant.data_export': ['cmd-tenant-data-export/v1'],
    'io.inspectorhub.cmd.tenant.purge': ['cmd-tenant-purge/v1'],
    // Managed-AI provider tier — per-tier AI allowances, fanned out per tenant
    // (the queue has no platform-scoped command and adding one would change the
    // envelope contract both sides validate).
    'io.inspectorhub.cmd.tenant.ai_caps': ['cmd-tenant-ai-caps/v1'],
    // A company admin renamed their own company in portal. SEPARATE from
    // cmd.tenant.update on purpose — see the schema below for why an
    // initialize-only sync could not carry this.
    'io.inspectorhub.cmd.tenant.rename': ['cmd-tenant-rename/v1'],
    // Privacy P3 — DSAR fan-out for a NON-account data subject (a client /
    // homeowner / notification recipient, never a staff account). Both await a
    // reply correlated by `replyto: dsar:<requestId>`.
    'io.inspectorhub.cmd.subject.export': ['cmd-subject-export/v1'],
    'io.inspectorhub.cmd.subject.erase': ['cmd-subject-erase/v1'],
    // The third right in the same family: correct a record that has already
    // been delivered. Like the two above it is an operation on behalf of a
    // natural person and awaits a reply (`replyto: dsar:<requestId>`), and
    // unlike them it is not idempotent — see the consumer's stale-guard note.
    'io.inspectorhub.cmd.report.correct': ['cmd-report-correct/v1'],
    // The operator's three answers to an import run waiting on a person:
    // deliver the converted bundle, hand it back unconverted, or say it has
    // been picked up. Each carries the PLATFORM PERSON acting, because the
    // whole point of routing these through the seam is that the audit row names
    // them instead of the workspace's own administrator.
    //
    // ⚠️ THE SAME THREE ACTIONS ALSO EXIST AS ADMIN POSTs, and that is not a
    // duplicate to be cleaned up. The POSTs are for somebody signed into the
    // workspace; these are for somebody who is not, and only the queue gives a
    // large, slow, retryable write dedup and a parking lot.
    'io.inspectorhub.cmd.migration.deliver': ['cmd-migration-deliver/v1'],
    'io.inspectorhub.cmd.migration.decline': ['cmd-migration-decline/v1'],
    'io.inspectorhub.cmd.migration.acknowledge': ['cmd-migration-acknowledge/v1'],
};

const cmdEnvelopeSchema = z.object({
    specversion: z.literal('1.0'),
    id: z.string().min(1),
    type: z.string().min(1),
    source: z.string().min(1),
    time: z.string().min(1),
    dataschema: z.string().min(1),
    tenantseq: z.number().int().nonnegative(),
    // A-21 batch 2 (additive-optional — no dataschema bump):
    /** Producer wants a `reply.tenant.updated` routed here (`wf:onboarding:<id>`). */
    replyto: z.string().optional(),
    /** Credential-stream sequence; present ONLY on credential-bearing commands.
     *  Guarded by `tenants.applied_cred_seq` (a stale credential never
     *  overwrites a newer one). Absent = legacy in-flight → apply unguarded. */
    credseq: z.number().int().positive().optional(),
    data: z.record(z.string(), z.unknown()),
});
export type CmdEnvelope = z.infer<typeof cmdEnvelopeSchema>;

/**
 * What the person accepted, captured PORTAL-side and travelling with the
 * command that would create their account.
 *
 * ── Why the basis is an enum here and not a free string ─────────────────────
 * `lib/auth/authority-basis.ts` says the two repositories duplicate this
 * vocabulary because they cannot import from each other — the engine is open
 * source and deployable by anyone, and a runtime dependency on a private SaaS
 * package would make that false. The cost of duplication is drift, and this is
 * the declared place drift surfaces: a projection naming a basis this side
 * cannot hold is refused AT THE BOUNDARY rather than stored and discovered
 * later by a reader who cannot interpret the row.
 *
 * Refusing the whole command is the intended consequence. A basis nobody on
 * this side can hold is not a field to drop tolerantly; the command it rides on
 * is the one that creates an account, and applying the rest of it would create
 * that account with an acceptance we could not record.
 *
 * ── `acceptedAt` is the HUMAN's timestamp ───────────────────────────────────
 * Not when the command was built and not when the row is written. On the
 * portal-originated path those differ by however long the onboarding workflow
 * took, and collapsing them would forge the legal fact to match the plumbing.
 */
const cmdAcceptanceSchema = z.object({
    /** Portal `identities.id`. Optional: a deployment with no portal has none. */
    actorIdentityRef: z.string().optional(),
    authorityBasis: z.enum(AUTHORITY_BASES),
    documents: z.array(z.object({
        doc: z.string().min(1),
        version: z.string().min(1),
        contentHash: z.string().min(1),
        /** Epoch ms. */
        acceptedAt: z.number(),
    })).min(1),
});

/** Per-type data validation (appliers call these — invalid data throws there,
 *  exhausts retries, and surfaces as a `failed` outbox row on portal). */
export const cmdTenantUpdateDataSchema = z.object({
    tenantId: z.string(),
    slug: z.string(),
    status: z.string(),
    tier: z.string().optional(),
    name: z.string().optional(),
    maxUsers: z.number().optional(),
    adminEmail: z.string().optional(),
    adminPasswordHash: z.string().optional(),
    /**
     * OPTIONAL AT THE SCHEMA LEVEL, REQUIRED WHERE IT MATTERS.
     *
     * `cmd.tenant.update` is one command carrying several unrelated intents: a
     * status flip, a seat-count change and a tier move all ride it, and none of
     * them creates anything, so none of them has an acceptance to carry. Making
     * the field mandatory here would reject that ordinary traffic and teach the
     * producer to synthesise a block to get past the schema — which is how a
     * fabricated acceptance enters a ledger.
     *
     * The requirement lives in the APPLIER (`applyAdminCredential`), where the
     * INSERT-versus-UPDATE branch is the thing that actually knows whether an
     * account is about to exist. A schema cannot know that.
     */
    acceptance: cmdAcceptanceSchema.optional(),
});
export const cmdSyncQuotaDataSchema = z.object({
    tenantId: z.string(),
    maxUsers: z.number(),
});
export const cmdSeedStarterContentDataSchema = z.object({
    tenantId: z.string(),
});
/** A-21 batch 3 — export straight into the shared EXPORTS_BUCKET. The r2Key is
 *  allocated by the portal workflow (stable across step retries) so a re-sent
 *  command overwrites the same object — idempotent. */
export const cmdDataExportDataSchema = z.object({
    tenantId: z.string(),
    r2Key: z.string(),
});
export const cmdPurgeDataSchema = z.object({
    tenantId: z.string(),
});
/**
 * Managed-AI provider tier — the caps that apply to THIS tenant, plus the tier
 * they were computed for.
 *
 * `caps` is the COMPLETE set: core replaces what it holds, so clearing a cap is
 * sending it as null (or omitting it), never a tombstone. The tier travels with
 * the numbers because the guard looks caps up as `caps[tier][metric]` — if the
 * tenant is moved to another tier before the next fan-out reaches them, the
 * lookup misses and they are simply unenforced, which is the safe direction.
 * OI receives NUMBERS, never a plan name to interpret.
 *
 * `caps` is a loose record on purpose (tolerant reader): a newer portal may name
 * a metric this build cannot enforce, and the applier drops those rather than
 * rejecting the whole command. Values are validated where they are stored.
 * Ordering rides the shared per-tenant `tenantseq` — an AI cap is ordinary
 * tenant state, so last-writer-wins under `tenants.applied_cmd_seq` is exactly
 * right and it needs no private sequence the way credentials do.
 */
export const cmdTenantAiCapsDataSchema = z.object({
    tenantId: z.string(),
    tier: z.string().min(1),
    caps: z.record(z.string(), z.unknown()),
});

/**
 * A company admin renamed their own company. Applied UNCONDITIONALLY.
 *
 * Why this is not a field on `cmd.tenant.update`: that command is a provisioning
 * SYNC, and its name write is deliberately initialize-only — it must not clobber
 * a name during a routine state push. A rename is the opposite intent, and the
 * two were conflated for as long as there were two name columns to hide it. The
 * sync wrote the container name (`tenants.name`) and the rename rode along; when
 * that column was dropped the rename had nowhere to land and became a silent
 * no-op, which is what made a separate command necessary rather than merely
 * tidy.
 *
 * The overwrite is correct because of WHO sends it. The portal endpoint is
 * gated on the membership role from the company JWT — the company's own admin,
 * not a platform operator. There is no third party here whose choice could be
 * trampled; it is the tenant renaming itself in the other of the two places it
 * can. (The two columns diverging is a DEFECT, not a design.)
 *
 * Renames the DISPLAY name only. `legal_name` is a separate column with a
 * separate meaning — agreements, signature certificates, the invoice "from"
 * party and the TCPA disclosure — and nothing here may touch it.
 *
 * Ordering rides the shared per-tenant `tenantseq`: a rename is ordinary tenant
 * state, so last-writer-wins under `tenants.applied_cmd_seq` is exactly right —
 * an overtaken rename SHOULD be dropped, because a newer one already won.
 */
export const cmdTenantRenameDataSchema = z.object({
    tenantId: z.string().min(1),
    companyName: z.string().trim().min(1),
}).strict();

/**
 * Privacy P3 — subject-scoped SAR export. `r2Key` is allocated PORTAL-side so a
 * re-dispatch overwrites the same object (idempotent, same trick as
 * cmd.tenant.data_export); the reply nonetheless echoes back the key core
 * actually wrote rather than the one it was told.
 *
 * `subjectPhone` is legitimate HERE and only here: the export assembler
 * (`server/services/subject-export.service.ts`) genuinely queries on it —
 * `contacts.phone`, `inspection_requests.client_phone`, and
 * `automation_logs.recipient` (which holds an E.164 number on SMS rows).
 *
 * `.strict()`, unlike the tenant-command siblings above. These two are the only
 * commands whose payload names a natural person, so an unexpected field is a
 * sender that believes core does something it does not — which must fail at the
 * boundary rather than be silently ignored. Both sides parse strictly; the
 * schemas are byte-for-byte mirrors of portal's `server/lib/cmd/envelope.ts`,
 * dataschema strings included.
 */
export const cmdSubjectExportDataSchema = z.object({
    tenantId: z.string(),
    subjectEmail: z.string(),
    subjectPhone: z.string().optional(),
    r2Key: z.string(),
}).strict();

/**
 * Privacy P3 — subject-scoped erasure. NOTE THE ABSENCE OF A PHONE.
 *
 * `runErasure` (`server/lib/compliance/erasure-orchestrator.ts`) takes
 * `{ tenantId, subjectEmail, retentionYears, … }` and contains no phone-keyed
 * query — every subject-locating predicate in it matches an email column. A
 * `subjectPhone` here would validate, ride the queue, reach the applier, and be
 * dropped, after which portal would record a COMPLETED ERASURE for data nothing
 * ever examined. So the field is omitted rather than optional-and-ignored, and
 * strict parsing makes a sender that adds it anyway fail loudly.
 *
 * Widening this is gated on core growing a real phone axis FIRST: `RunErasureInput`
 * + every subject-locating query + the manifest + `ERASURE_SUBJECT_AXIS` in
 * `server/lib/compliance/erasure-coverage.ts`, which is what the reply discloses.
 */
export const cmdSubjectEraseDataSchema = z.object({
    tenantId: z.string(),
    subjectEmail: z.string(),
}).strict();

/**
 * Correct a field of a report that has already been delivered.
 *
 * `.strict()`, and for the reason the two schemas above are: this payload names
 * a natural person's data, so an unexpected field means the sender believes
 * something happens here that does not. Accepted-and-dropped would be recorded
 * on the other side as a correction covering a field nothing ever wrote.
 *
 * ── The field list is READ, not restated ───────────────────────────────────
 * `CORRECTABLE_FIELDS` is the correction service's own enum. A second
 * hand-written copy here is how a boundary starts accepting a name the service
 * cannot act on: the command would validate, ride the queue, and throw at the
 * applier — where it looks like a fault and is retried forever. The list is
 * short because only fields FROZEN INTO THE SIGNED SNAPSHOT need an amendment
 * at all; everything resolved live at read time corrects itself.
 *
 * ── Two fields that are deliberately absent ────────────────────────────────
 * There is NO `deferKeys`. The service accepts one so that asking to hold an
 * artefact back can be REFUSED rather than quietly honoured; over this seam the
 * request cannot be expressed at all, which is the stronger position.
 *
 * There is NO `correctedBy`. Who authorised the correction is the command's
 * `replyto` handle, not a value the sender may choose: the amendment records it,
 * and a sender-supplied identifier would be written into a column that otherwise
 * holds a LOCAL user id — resolvable by nothing, and indistinguishable from one
 * that is.
 *
 * MIRRORED BY HAND on the producing side, dataschema string included. The two
 * repositories deploy independently: deploy THIS side first, because a sender
 * emitting a command this build does not know parks it.
 */
export const cmdReportCorrectDataSchema = z.object({
    tenantId: z.string().min(1),
    inspectionId: z.string().min(1),
    field: z.enum(CORRECTABLE_FIELDS),
    /** The replacement value. The service refuses an empty one where the record requires a value. */
    to: z.string().max(320),
    /** Published on the amendment and shown to whoever reads the report's trail. */
    reason: z.string().min(1).max(500),
}).strict();

/**
 * WHO AT THE DEPLOYMENT OPERATOR is acting, travelling with the command.
 *
 * REQUIRED on all three migration commands, and that is the difference between
 * them and every other command on this seam. The others are unattended —
 * provisioning, a seat reconciliation, a cron pass — and giving those a stand-in
 * actor would make a scheduled job indistinguishable in the audit trail from a
 * person opening a customer's workspace. These three are the opposite: each one
 * is a person acting on somebody else's file, and a row that could not name them
 * would name the workspace's own administrator instead, which is the state this
 * whole seam exists to end.
 *
 * ⚠️ NOT A USER ID OF OURS. `platformAdminId` is the sender's own identifier for
 * its staff and resolves to nothing in this database, which is why it lands in
 * `audit_logs.platform_actor_id` and never in `user_id`. Putting it in `user_id`
 * would make it indistinguishable from a workspace member id.
 */
const cmdPlatformActorSchema = z.object({
    platformAdminId: z.string().min(1),
    email: z.string().min(1),
});

/**
 * Deliver a converted bundle into a run that has been waiting for one.
 *
 * `.strict()`, like the subject commands: the bundle is somebody else's contact
 * data, so a field this build does not recognise means the sender believes
 * something happens here that does not. `bundle` itself is an open record — it
 * is validated in full by the bundle parser inside the applier, which produces a
 * far better message than a mirrored copy of that schema would.
 *
 * The INTENT is deliberately absent. What the workspace asked for was settled
 * when they opened the run, and a delivery allowed to restate it would be
 * allowed to widen it.
 */
export const cmdMigrationDeliverDataSchema = z.object({
    tenantId: z.string().min(1),
    batchId: z.string().min(1),
    bundle: z.record(z.string(), z.unknown()),
    actor: cmdPlatformActorSchema,
}).strict();

/**
 * Hand a waiting run back, unconverted, with the reason on the run.
 *
 * `reason` is required and non-empty for the reason the route's own version is:
 * a run left alone reaches `expired`, which says the clock ran out, and
 * `abandoned` says the workspace stopped. Neither is true of a file a person
 * read and could not convert, and a refusal with no stated ground is
 * indistinguishable from one nobody looked at.
 */
export const cmdMigrationDeclineDataSchema = z.object({
    tenantId: z.string().min(1),
    batchId: z.string().min(1),
    reason: z.string().min(1).max(500),
    actor: cmdPlatformActorSchema,
}).strict();

/** Say, to the person waiting, that their file has been picked up. Moves
 *  nothing: acknowledging a file is not converting it. */
export const cmdMigrationAcknowledgeDataSchema = z.object({
    tenantId: z.string().min(1),
    batchId: z.string().min(1),
    actor: cmdPlatformActorSchema,
}).strict();

export function parseCmdEnvelope(json: unknown): CmdEnvelope | null {
    let candidate: unknown = json;
    if (typeof candidate === 'string') {
        try { candidate = JSON.parse(candidate); } catch { return null; }
    }
    const result = cmdEnvelopeSchema.safeParse(candidate);
    return result.success ? result.data : null;
}

/**
 * Which ENVELOPE fields a message failed validation on — names only, so the
 * dead-letter row can say WHY a message could not be read without holding the
 * message. Two things make that safe structurally rather than by promise:
 * values never leave this function, and the returned names are intersected with
 * this schema's own top-level keys, so nothing from inside `data` (a
 * `z.record(z.unknown())`, which never produces an issue of its own) can appear.
 */
export function cmdEnvelopeIssueFields(json: unknown): string[] {
    let candidate: unknown = json;
    if (typeof candidate === 'string') {
        try { candidate = JSON.parse(candidate); } catch { return ['<not-json>']; }
    }
    if (candidate === null || typeof candidate !== 'object') return ['<not-an-object>'];
    const result = cmdEnvelopeSchema.safeParse(candidate);
    if (result.success) return [];
    const known = new Set(Object.keys(cmdEnvelopeSchema.shape));
    const fields = result.error.issues
        .map((issue) => String(issue.path[0] ?? ''))
        .filter((name) => known.has(name));
    return [...new Set(fields)].sort();
}

export function isKnownCmd(type: string, dataschema: string): boolean {
    const versions = KNOWN_CMD_TYPES[type];
    return versions !== undefined && versions.includes(dataschema);
}
