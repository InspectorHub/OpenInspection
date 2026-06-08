/**
 * Track I-a GDPR (spec §5) — the erasure orchestrator.
 *
 * Walks the erasure-relevant tables for a single data subject (by email),
 * decides per row-state, executes, and writes ONE append-only `erasure_log`
 * decision row (Art. 5(2)/30 accountability).
 *
 * Decision policy (spec §3 D2/D5):
 *  - SIGNED agreement rows (envelope status 'signed' OR signedAt not null) ->
 *    ANONYMIZE the satellite PII (D5 field set). KEEP signature_base64,
 *    signed_at, viewed_at, role, channel, content_snapshot, content_hash, and
 *    the entire esign_audit_logs chain. legalBasis art_17_3_e; retentionExpiry =
 *    signedAt + retentionYears (encoded as a Unix-MS integer).
 *  - DRAFT / unsigned envelopes (pending/sent/viewed/declined/expired, never
 *    signed) -> DELETE the envelope row + its signer rows.
 *  - Non-agreement client PII (inspections client columns, contacts) -> NULL
 *    in-place (the pre-existing behavior).
 *
 * Hard rules: NEVER touch esign_audit_logs; NEVER clear signature_base64.
 * Fail-closed: each step is wrapped — a throw is caught, recorded in the
 * decision array, and flips the overall status to 'partially_completed';
 * the other steps still land. Never silently report success.
 *
 * The manifest (`erasure-manifest.ts`) is the column-level catalogue / CI-lint
 * source of truth; this orchestrator is the concrete Drizzle executor that
 * realizes those rules with tenant-scoped, row-state-aware SQL.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
    inspections,
    contacts,
    agreementRequests,
    agreementSigners,
    erasureLog,
} from '../db/schema';

/** A single recorded erasure decision (serialized into `decisions_json`). */
export interface ErasureDecision {
    table: string;
    action: 'delete' | 'null' | 'anonymize';
    count: number;
    legalBasis?: 'art_17_3_b' | 'art_17_3_e';
    /** Unix-MS integer: signedAt + retentionYears. Present on anonymize steps. */
    retentionExpiry?: number;
    /** Set when this step threw (fail-closed accountability). */
    error?: string;
}

export interface RunErasureInput {
    tenantId: string;
    subjectEmail: string;
    retentionYears: number;
    requestedBy?: string;
    identityBasis?: string;
}

export interface ErasureSummary {
    status: 'completed' | 'partially_completed' | 'refused';
    anonymizedCount: number;
    deletedCount: number;
    retainedCount: number;
    decisions: ErasureDecision[];
    logId: string;
}

// Accept either the D1 drizzle type (prod) or the better-sqlite3 test db.
// Both expose the same query-builder surface used here.
type AnyDb = DrizzleD1Database<Record<string, unknown>> | { [k: string]: unknown };

/**
 * Sentinel written into NOT NULL PII columns on anonymize (`name`, `email`).
 * Nullable PII columns are set to NULL; NOT NULL columns cannot be, so they get
 * this non-PII marker instead (matches the standing "sentinel-clear for NOT NULL
 * columns" convention). The value carries no personal data.
 */
const ERASED_SENTINEL = '[erased]';

/** Driver-tolerant row-count extraction (D1: meta.changes; better-sqlite3: changes). */
function changeCount(res: unknown): number {
    const r = res as { meta?: { changes?: number }; changes?: number } | undefined;
    return r?.meta?.changes ?? r?.changes ?? 0;
}

/** Add whole years to a Unix-MS timestamp, returning a Unix-MS integer. */
function addYearsMs(ms: number, years: number): number {
    const d = new Date(ms);
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d.getTime();
}

/** Coerce a timestamp column value (Date | number | null) to Unix-MS or null. */
function toMs(v: unknown): number | null {
    if (v == null) return null;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Run a data-subject erasure for `subjectEmail` within `tenantId`. The caller
 * supplies `retentionYears` (read from tenant_configs.agreement_retention_years).
 */
export async function runErasure(
    rawDb: AnyDb,
    input: RunErasureInput,
): Promise<ErasureSummary> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;
    const { tenantId, subjectEmail, retentionYears } = input;
    const decisions: ErasureDecision[] = [];
    let anonymizedCount = 0;
    let deletedCount = 0;
    let retainedCount = 0;
    let failed = false;

    /** Run one step fail-closed: record its decision; a throw flips the status. */
    async function step(
        table: string,
        action: ErasureDecision['action'],
        extra: Pick<ErasureDecision, 'legalBasis' | 'retentionExpiry'>,
        fn: () => Promise<number>,
    ): Promise<void> {
        try {
            const count = await fn();
            if (count > 0) decisions.push({ table, action, count, ...extra });
            if (action === 'anonymize') anonymizedCount += count;
            else if (action === 'delete') deletedCount += count;
        } catch (err) {
            failed = true;
            decisions.push({
                table, action, count: 0, ...extra,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // ── Locate agreement envelopes for the subject (signed vs draft split) ────
    // Envelopes the subject is the named client on, OR is a signer on.
    const byClient = await db.select().from(agreementRequests)
        .where(and(eq(agreementRequests.tenantId, tenantId), eq(agreementRequests.clientEmail, subjectEmail)))
        .all();
    const signerRows = await db.select().from(agreementSigners)
        .where(and(eq(agreementSigners.tenantId, tenantId), eq(agreementSigners.email, subjectEmail)))
        .all();

    const reqIdsFromSigners: string[] = signerRows.map((s: { requestId: string }) => s.requestId);
    const envelopes = byClient as Array<{ id: string; status: string; signedAt: unknown }>;
    if (reqIdsFromSigners.length > 0) {
        const extra = await db.select().from(agreementRequests)
            .where(and(eq(agreementRequests.tenantId, tenantId), inArray(agreementRequests.id, reqIdsFromSigners)))
            .all();
        const seen = new Set(envelopes.map((e) => e.id));
        for (const e of extra as typeof envelopes) if (!seen.has(e.id)) { envelopes.push(e); seen.add(e.id); }
    }

    const isSigned = (e: { status: string; signedAt: unknown }) => e.status === 'signed' || toMs(e.signedAt) != null;
    const signedEnvelopes = envelopes.filter(isSigned);
    const draftEnvelopes = envelopes.filter((e) => !isSigned(e));

    // ── 1) Signed envelopes: anonymize the SUBJECT'S signer rows (D5) ─────────
    // Tenant + subject email scoped, restricted to signed envelopes so other
    // signers and unrelated rows are never touched. Idempotent: a re-run finds
    // email already cleared -> matches 0 rows.
    for (const env of signedEnvelopes) {
        const signedAtMs = toMs(env.signedAt);
        const anonExtra: Pick<ErasureDecision, 'legalBasis' | 'retentionExpiry'> = signedAtMs != null
            ? { legalBasis: 'art_17_3_e', retentionExpiry: addYearsMs(signedAtMs, retentionYears) }
            : { legalBasis: 'art_17_3_e' };
        await step('agreement_signers', 'anonymize', anonExtra, async () => {
            // name + email are NOT NULL -> sentinel-clear; the rest are nullable.
            const res = await db.update(agreementSigners)
                .set({ name: ERASED_SENTINEL, email: ERASED_SENTINEL, ipAddress: null, userAgent: null, onBehalfOf: null, onBehalfDisclaimer: null })
                .where(and(
                    eq(agreementSigners.tenantId, tenantId),
                    eq(agreementSigners.requestId, env.id),
                    eq(agreementSigners.email, subjectEmail),
                ))
                .run();
            const c = changeCount(res);
            retainedCount += c; // anonymized rows are retained-under-exemption evidence
            return c;
        });
        // Envelope denormalized client identity.
        await step('agreement_requests', 'anonymize', anonExtra, async () => {
            // client_email is NOT NULL -> sentinel-clear; client_name nullable.
            const res = await db.update(agreementRequests)
                .set({ clientName: null, clientEmail: ERASED_SENTINEL })
                .where(and(
                    eq(agreementRequests.tenantId, tenantId),
                    eq(agreementRequests.id, env.id),
                    eq(agreementRequests.clientEmail, subjectEmail),
                ))
                .run();
            return changeCount(res);
        });
    }

    // ── 2) Draft/unsigned envelopes: delete signer rows then the envelope ─────
    if (draftEnvelopes.length > 0) {
        const draftIds = draftEnvelopes.map((e) => e.id);
        await step('agreement_signers', 'delete', {}, async () => {
            const res = await db.delete(agreementSigners)
                .where(and(eq(agreementSigners.tenantId, tenantId), inArray(agreementSigners.requestId, draftIds)))
                .run();
            return changeCount(res);
        });
        await step('agreement_requests', 'delete', {}, async () => {
            const res = await db.delete(agreementRequests)
                .where(and(eq(agreementRequests.tenantId, tenantId), inArray(agreementRequests.id, draftIds)))
                .run();
            return changeCount(res);
        });
    }

    // ── 3) Non-agreement client PII: null in-place ────────────────────────────
    await step('inspections', 'null', {}, async () => {
        const res = await db.update(inspections)
            .set({ clientName: null, clientEmail: null, clientPhone: null })
            .where(and(eq(inspections.tenantId, tenantId), eq(inspections.clientEmail, subjectEmail)))
            .run();
        return changeCount(res);
    });
    // contacts.name is NOT NULL and a CRM contact carries no legal-retention
    // basis, so the row is deleted outright rather than nulled in-place.
    await step('contacts', 'delete', {}, async () => {
        const res = await db.delete(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, subjectEmail)))
            .run();
        return changeCount(res);
    });

    // ── Write the single append-only decision-log row ─────────────────────────
    const status: ErasureSummary['status'] = failed ? 'partially_completed' : 'completed';
    const logId = crypto.randomUUID();
    await db.insert(erasureLog).values({
        id: logId,
        tenantId,
        subjectEmail,
        requestedBy: input.requestedBy ?? null,
        identityBasis: input.identityBasis ?? null,
        status,
        decisionsJson: JSON.stringify(decisions),
        retainedCount,
        anonymizedCount,
        deletedCount,
        responseNote: null,
        createdAt: Date.now(),
    });

    return { status, anonymizedCount, deletedCount, retainedCount, decisions, logId };
}
