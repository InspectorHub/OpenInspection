/**
 * Track I-a GDPR (spec §5) — the erasure orchestrator.
 *
 * Walks the erasure-relevant tables for a single data subject (by email),
 * decides per row-state, executes, and writes ONE append-only `erasure_log`
 * decision row (Art. 5(2)/30 accountability).
 *
 * Decision policy (spec §3 D2/D5):
 *  - EVIDENCE-BEARING agreement rows (envelope status 'signed' OR signedAt not
 *    null OR ANY signer row has signed) -> ANONYMIZE the satellite PII (D5 field
 *    set). KEEP signature_base64, signed_at, viewed_at, role, channel,
 *    content_snapshot, content_hash, and the entire esign_audit_logs chain.
 *    legalBasis art_17_3_e; retentionExpiry = (envelope signedAt, else earliest
 *    signer signed_at) + retentionYears (encoded as a Unix-MS integer). A
 *    partially-signed envelope (e.g. completionPolicy 'all', one signer signed,
 *    envelope still 'viewed'/signed_at NULL) is evidence-bearing, NOT a draft.
 *  - TRUE-DRAFT envelopes (NO signer has EVER signed: pending/sent/viewed/
 *    declined/expired with every signer unsigned) -> DELETE the envelope row +
 *    its signer rows.
 *  - Non-agreement client PII lives on `contacts` (the `inspections.client_*`
 *    columns are a frozen, unread cache dropped in a later migration) -> the
 *    `contacts` row is DELETED (name is NOT NULL, no legal-retention basis),
 *    preceded by an `inspection_people` orphan-cleanup delete so no row
 *    dangles at the about-to-be-deleted contact id.
 *
 * Hard rules: NEVER touch esign_audit_logs; NEVER clear signature_base64.
 * Fail-closed: each step is wrapped — a throw is caught, recorded in the
 * decision array, and flips the overall status to 'partially_completed';
 * the other steps still land. Never silently report success.
 *
 * The manifest (`erasure-manifest.ts`) is the column-level catalogue / CI-lint
 * source of truth; this orchestrator is the concrete Drizzle executor that
 * realizes those rules with tenant-scoped, row-state-aware SQL.
 *
 * Binding: `tests/unit/erasure-manifest-coverage.spec.ts` asserts every
 * manifest anonymize/delete/null rule is referenced in this file, preventing
 * silent manifest↔orchestrator drift.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
    contacts,
    inspectionPeople,
    agreementRequests,
    agreementSigners,
    erasureLog,
} from '../db/schema';
import {
    ANONYMIZE_SIGNER_PII,
    ANONYMIZE_REQUEST_PII,
} from './anonymize-pii';

/** A single recorded erasure decision (serialized into `decisions_json`). */
interface ErasureDecision {
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

    // An envelope holds retainable signed EVIDENCE if the envelope itself is
    // signed OR ANY of its signer rows has signed — even when the envelope is
    // still incomplete (e.g. completionPolicy 'all', one signer signed, others
    // pending; envelope status 'viewed'/'sent', signed_at NULL). Such a partial
    // envelope already carries collected signature evidence (image + IP + UA +
    // audit chain) that must be ANONYMIZED-and-retained, never hard-deleted.
    // Load, in ONE grouped query (tenant-scoped, no N+1), the request ids that
    // have at least one signed signer row, and the EARLIEST signer signed_at per
    // request (used to anchor retentionExpiry when the envelope's own signedAt is
    // NULL). Only envelopes where NO signer has EVER signed are true drafts.
    const earliestSignerSignedAt = new Map<string, number>();
    const envelopeIds = envelopes.map((e) => e.id);
    if (envelopeIds.length > 0) {
        const allSigners = await db.select().from(agreementSigners)
            .where(and(eq(agreementSigners.tenantId, tenantId), inArray(agreementSigners.requestId, envelopeIds)))
            .all();
        for (const s of allSigners as Array<{ requestId: string; status: string; signedAt: unknown }>) {
            const sMs = toMs(s.signedAt);
            const hasSigned = s.status === 'signed' || sMs != null;
            if (!hasSigned) continue;
            if (sMs != null) {
                const prev = earliestSignerSignedAt.get(s.requestId);
                if (prev == null || sMs < prev) earliestSignerSignedAt.set(s.requestId, sMs);
            } else if (!earliestSignerSignedAt.has(s.requestId)) {
                // Signed signer without a timestamp: record presence; a later row
                // with a real timestamp may still tighten the anchor.
                earliestSignerSignedAt.set(s.requestId, Number.POSITIVE_INFINITY);
            }
        }
    }
    const hasSignedEvidence = (e: { id: string; status: string; signedAt: unknown }) =>
        e.status === 'signed' || toMs(e.signedAt) != null || earliestSignerSignedAt.has(e.id);
    const evidenceEnvelopes = envelopes.filter(hasSignedEvidence);
    const draftEnvelopes = envelopes.filter((e) => !hasSignedEvidence(e));

    // ── 1) Evidence envelopes: anonymize the SUBJECT'S signer rows (D5) ───────
    // Tenant + subject email scoped, restricted to evidence-bearing envelopes so
    // other signers and unrelated rows are never touched. Idempotent: a re-run
    // finds email already cleared -> matches 0 rows.
    for (const env of evidenceEnvelopes) {
        // Anchor retentionExpiry on the envelope's signedAt when present; else on
        // the earliest signer signed_at (a real signing event). When neither
        // yields a finite timestamp (signed but timestamp-less), omit
        // retentionExpiry and keep legalBasis only.
        const envSignedAtMs = toMs(env.signedAt);
        const signerAnchor = earliestSignerSignedAt.get(env.id);
        const anchorMs = envSignedAtMs ?? (signerAnchor != null && Number.isFinite(signerAnchor) ? signerAnchor : null);
        const anonExtra: Pick<ErasureDecision, 'legalBasis' | 'retentionExpiry'> = anchorMs != null
            ? { legalBasis: 'art_17_3_e', retentionExpiry: addYearsMs(anchorMs, retentionYears) }
            : { legalBasis: 'art_17_3_e' };
        await step('agreement_signers', 'anonymize', anonExtra, async () => {
            // Shared satellite-PII SET (name/email sentinel, rest NULL). KEEP
            // signature_base64 — it is the retained evidence on a DSAR. The
            // retention sweep reuses ANONYMIZE_SIGNER_PII and adds signature
            // destruction; sharing the SET keeps the two paths byte-identical.
            const res = await db.update(agreementSigners)
                .set(ANONYMIZE_SIGNER_PII)
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
            // Shared satellite-PII SET (client_email sentinel, client_name NULL).
            // KEEP signature_base64 on a DSAR; the sweep reuses this same SET.
            const res = await db.update(agreementRequests)
                .set(ANONYMIZE_REQUEST_PII)
                .where(and(
                    eq(agreementRequests.tenantId, tenantId),
                    eq(agreementRequests.id, env.id),
                    eq(agreementRequests.clientEmail, subjectEmail),
                ))
                .run();
            const c = changeCount(res);
            retainedCount += c; // anonymized envelopes are also retained-under-exemption evidence
            return c;
        });
    }

    // ── 2) True-draft envelopes (NO signer ever signed): delete rows ──────────
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

    // ── 3) Non-agreement client PII lives on `contacts` now (the
    // `inspections.client_*` columns are a frozen, unread cache dropped in a
    // later migration — the erasure orchestrator no longer writes them). ────
    //
    // Orphan cleanup FIRST: resolve the subject's contact id(s) and delete the
    // `inspection_people` rows that reference them, so nothing dangles once the
    // contact row itself is deleted below. Resolving the contact id(s) before
    // the contacts delete (rather than joining contacts.email at delete time)
    // means this step works even if run standalone/retried after the contacts
    // row is already gone (idempotent: 0 contacts found -> 0 rows deleted).
    await step('inspection_people', 'delete', {}, async () => {
        const subjectContacts = await db.select({ id: contacts.id }).from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, subjectEmail)))
            .all();
        const contactIds = (subjectContacts as Array<{ id: string }>).map((c) => c.id);
        if (contactIds.length === 0) return 0;
        const res = await db.delete(inspectionPeople)
            .where(and(eq(inspectionPeople.tenantId, tenantId), inArray(inspectionPeople.contactId, contactIds)))
            .run();
        return changeCount(res);
    });
    // contacts.name is NOT NULL and a CRM contact carries no legal-retention
    // basis, so the row is deleted outright rather than nulled in-place. This
    // is the LIVE source of client PII — deleting it makes every primary-client
    // join (getPrimaryClient / getInspection / listInspections / agreements)
    // correctly resolve to null/absent for the subject.
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
        createdAt: new Date(),
    });

    return { status, anonymizedCount, deletedCount, retainedCount, decisions, logId };
}
