import { z } from 'zod';

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
 * can. (`docs/superpowers/specs/2026-08-04-tenant-legal-name-and-document-identity.md`
 * §1.3 records the two columns diverging as a DEFECT, not a design.)
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
