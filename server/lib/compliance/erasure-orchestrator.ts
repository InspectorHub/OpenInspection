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
import { and, eq, inArray, or } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
    contacts,
    notificationPreferences,
    inspectionPeople,
    agreementRequests,
    agreementSigners,
    invoices,
    orderPayments,
    conciergeConfirmTokens,
    inspectionAccessTokens,
    inspectionRequests,
    reports,
    auditLogs,
    erasureLog,
} from '../db/schema';
import {
    ANONYMIZE_SIGNER_PII,
    ANONYMIZE_REQUEST_PII,
    ANONYMIZE_BOOKING_REQUEST_PII,
    ANONYMIZE_AUDIT_PII,
} from './anonymize-pii';

/**
 * What a report title becomes. Not blank: a reader of the version chain needs
 * to see that a document existed and was deliberately cleared, not wonder
 * whether the field was never filled in.
 */
const ANONYMIZED_TITLE = 'Inspection Report (details removed)';

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

    // ── 3) #88 residences: invoices, tokens, booking requests ────────────────
    // Resolve the subject's contact id(s) BEFORE the contacts delete below, so
    // an invoice carrying only the contact reference (client_email never
    // denormalized) is still found.
    const subjectContactRows = await db.select({ id: contacts.id }).from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(contacts.email, subjectEmail)))
        .all();
    const subjectContactIds = (subjectContactRows as Array<{ id: string }>).map((c) => c.id);

    /** Subject's inspection ids via `inspection_people` — there is no
     *  denormalized client column on `inspections`. Memoized: three steps
     *  below need the same list and it cannot change mid-run. */
    let inspIdCache: string[] | null = null;
    async function subjectInspectionIds(): Promise<string[]> {
        if (inspIdCache) return inspIdCache;
        if (subjectContactIds.length === 0) return (inspIdCache = []);
        const rows = await db.select({ id: inspectionPeople.inspectionId }).from(inspectionPeople)
            .where(and(eq(inspectionPeople.tenantId, tenantId), inArray(inspectionPeople.contactId, subjectContactIds))).all();
        return (inspIdCache = [...new Set((rows as Array<{ id: string }>).map((r) => r.id))]);
    }

    // A preference row is keyed on a contact id, and contact ids are reused.
    // Leaving these behind gives the NEXT person at that id the erased
    // subject's mute settings — invisibly, and in the direction that withholds
    // mail. Scoped to `subject_kind = 'contact'`: a staff member's own
    // preferences are not a consumer data subject's.
    await step('notification_preferences', 'delete', {}, async () => {
        if (subjectContactIds.length === 0) return 0;
        const res = await db.delete(notificationPreferences)
            .where(and(
                eq(notificationPreferences.tenantId, tenantId),
                eq(notificationPreferences.subjectKind, 'contact'),
                inArray(notificationPreferences.subjectId, subjectContactIds),
            ))
            .run();
        return changeCount(res);
    });

    // The money record is the tenant's ledger (P-4 authority chain) and stays;
    // only the denormalized client identity is nulled.
    await step('invoices', 'null', {}, async () => {
        const match = subjectContactIds.length > 0
            ? or(eq(invoices.clientEmail, subjectEmail), inArray(invoices.contactId, subjectContactIds))
            : eq(invoices.clientEmail, subjectEmail);
        const res = await db.update(invoices)
            .set({ clientName: null, clientEmail: null })
            .where(and(eq(invoices.tenantId, tenantId), match))
            .run();
        return changeCount(res);
    });

    // Single-use concierge magic-link tokens addressed to the subject.
    await step('concierge_confirm_tokens', 'delete', {}, async () => {
        const res = await db.delete(conciergeConfirmTokens)
            .where(and(eq(conciergeConfirmTokens.tenantId, tenantId), eq(conciergeConfirmTokens.clientEmail, subjectEmail)))
            .run();
        return changeCount(res);
    });

    // Persistent portal links — deleting them deliberately REVOKES portal
    // access: an erased subject's magic links must stop working.
    await step('inspection_access_tokens', 'delete', {}, async () => {
        const res = await db.delete(inspectionAccessTokens)
            .where(and(eq(inspectionAccessTokens.tenantId, tenantId), eq(inspectionAccessTokens.recipientEmail, subjectEmail)))
            .run();
        return changeCount(res);
    });

    // Booking requests: the ROW survives (`inspections.request_id` carries a
    // frozen legacy FK to it), identity cleared in place via the shared SET.
    await step('inspection_requests', 'anonymize', { legalBasis: 'art_17_3_e' }, async () => {
        const res = await db.update(inspectionRequests)
            .set(ANONYMIZE_BOOKING_REQUEST_PII)
            .where(and(eq(inspectionRequests.tenantId, tenantId), eq(inspectionRequests.clientEmail, subjectEmail)))
            .run();
        const c = changeCount(res);
        retainedCount += c; // rows retained with identity cleared under Art. 17(3)(e)
        return c;
    });

    // A report TITLE is written by a human and routinely carries the property
    // address ("123 Oak St — Radon"). The row itself survives: it is the spine
    // of a signed, delivered document, and deleting it would strand the version
    // chain that proves what was delivered. Only the title is cleared.
    //
    // Scoped through the subject's inspections rather than by matching the
    // title text — an address can be spelled several ways, and a title that
    // happens to mention someone else's street is not this subject's data.
    await step('reports', 'anonymize', { legalBasis: 'art_17_3_e' }, async () => {
        const inspIds = await subjectInspectionIds();
        if (inspIds.length === 0) return 0;
        const res = await db.update(reports)
            .set({ title: ANONYMIZED_TITLE })
            .where(and(eq(reports.tenantId, tenantId), inArray(reports.inspectionId, inspIds)))
            .run();
        const c = changeCount(res);
        retainedCount += c; // rows retained with identity cleared under Art. 17(3)(e)
        return c;
    });

    // The payment ledger is append-only and financial — the ROWS stay, retained
    // under the accounting/tax obligation. `note` is the one column a human
    // writes free-hand on a row tied to an identified client, so it is the one
    // column cleared. Located BOTH ways, because neither key alone reaches every
    // row: a deposit taken before the invoice exists has no invoice_id, and a
    // payment against a standalone invoice has no inspection_id. The invoice
    // locator matches on contact_id, which survives the invoices step above
    // (that one nulls client_name/client_email only).
    await step('order_payments', 'anonymize', { legalBasis: 'art_17_3_b' }, async () => {
        if (subjectContactIds.length === 0) return 0;
        const inspIds = await subjectInspectionIds();
        const invRows = await db.select({ id: invoices.id }).from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.contactId, subjectContactIds)))
            .all();
        const invIds = [...new Set((invRows as Array<{ id: string }>).map((i) => i.id))];
        if (inspIds.length === 0 && invIds.length === 0) return 0;

        const reach = [
            ...(inspIds.length > 0 ? [inArray(orderPayments.inspectionId, inspIds)] : []),
            ...(invIds.length > 0 ? [inArray(orderPayments.invoiceId, invIds)] : []),
        ];
        const res = await db.update(orderPayments)
            .set({ note: null })
            .where(and(eq(orderPayments.tenantId, tenantId), reach.length === 1 ? reach[0] : or(...reach)))
            .run();
        const c = changeCount(res);
        retainedCount += c; // financial rows retained with the free text cleared
        return c;
    });

    // `metadata` is free-form JSON: audit.ts strips the machine-detectable
    // identifiers at write, prose it cannot see at all, and older rows predate
    // it — so the whole value goes. Located by entity id (inspections/contacts).
    await step('audit_logs', 'anonymize', { legalBasis: 'art_17_3_b' }, async () => {
        const targets = [...(await subjectInspectionIds()), ...subjectContactIds];
        if (targets.length === 0) return 0;
        const c = changeCount(await db.update(auditLogs).set(ANONYMIZE_AUDIT_PII)
            .where(and(eq(auditLogs.tenantId, tenantId), inArray(auditLogs.entityId, targets))).run());
        retainedCount += c; return c;   // the event is retained, the free text is not
    });

    // ── 4) Non-agreement client PII lives on `contacts` now (the
    // `inspections.client_*` columns are a frozen, unread cache dropped in a
    // later migration — the erasure orchestrator no longer writes them). ────
    //
    // Orphan cleanup FIRST: delete the `inspection_people` rows referencing the
    // subject, so nothing dangles once the contact row goes below. The ids were
    // resolved BEFORE any delete, so a standalone re-run is idempotent (0
    // contacts found -> 0 rows deleted) rather than a no-op that misses rows.
    await step('inspection_people', 'delete', {}, async () => {
        if (subjectContactIds.length === 0) return 0;
        const res = await db.delete(inspectionPeople)
            .where(and(eq(inspectionPeople.tenantId, tenantId), inArray(inspectionPeople.contactId, subjectContactIds)))
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
