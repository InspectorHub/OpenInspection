/**
 * Privacy P3 — assemble everything core holds about ONE data subject
 * (Art. 15 right of access), tenant-scoped.
 *
 * The subject here is a NON-ACCOUNT person: a client, a homeowner, an agent, a
 * notification recipient. Staff (`users`) are explicitly out of scope — see the
 * `users.*` entries in `erasure-out-of-scope.ts`, which record the same call for
 * the erasure side.
 *
 * WHAT DEFINES THE SET. The collections below track the ERASURE CATALOGUE
 * (`erasure-manifest.ts`) table for table. That is deliberate: an access request
 * and an erasure request are the same question asked twice, and a table core
 * will erase but never disclose — or disclose but never erase — is a gap in one
 * of the two answers. When a table is added to the catalogue it belongs here.
 *
 * TWO AXES, NOT ONE. Unlike erasure, this path genuinely queries a phone when
 * portal supplies one: `contacts.phone`, `inspection_requests.client_phone`, and
 * `automation_logs.recipient` (which holds an E.164 number on SMS rows). That
 * asymmetry is the whole reason `cmd.subject.export` carries a phone and
 * `cmd.subject.erase` does not.
 *
 * WHAT IS DELIBERATELY WITHHELD:
 *   - OTHER people's PII. Only the subject's own `agreement_signers` rows travel;
 *     a co-signer on the same envelope is a different data subject.
 *   - LIVE CREDENTIALS. Portal links, share tokens and their hashes are redacted
 *     by `redact()` below. The export is written to R2 and handed over by a
 *     tenant admin, so a working token in it is a credential in a file, and a
 *     subject's right to a copy of their data is not a right to a bearer token.
 *   - `esign_audit_logs`. The tamper-evident chain is the tenant's integrity
 *     evidence about a document, not the subject's personal data, and the
 *     erasure orchestrator is likewise forbidden from touching it.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import {
    contacts,
    inspections,
    inspectionPeople,
    inspectionResults,
    inspectionRequests,
    agreementRequests,
    agreementSigners,
    invoices,
    orderPayments,
    conciergeConfirmTokens,
    inspectionAccessTokens,
    reportViews,
    reports,
    repairRequests,
    repairRequestItems,
    notificationPreferences,
    emailSuppressions,
    automationLogs,
    auditLogs,
    erasureLog,
} from '../lib/db/schema';

/** Accept either the D1 drizzle handle (prod) or the better-sqlite3 test db —
 *  same reasoning, and same `any` escape hatch, as `runErasure`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

type Row = Record<string, unknown>;

export interface SubjectLocator {
    tenantId: string;
    subjectEmail: string;
    /** Only ever supplied on an ACCESS request — erasure has no phone axis. */
    subjectPhone?: string | undefined;
}

export interface SubjectDataset {
    /** File-stem -> rows, one JSON entry per collection in the archive. */
    collections: Record<string, Row[]>;
    /** Inspections the subject is a person on — also the photo-prefix roots. */
    inspectionIds: string[];
    contactIds: string[];
    /** Total rows across every collection (the export manifest's `rows`). */
    rows: number;
    /** Which axes actually matched something, for the archive README. */
    matchedOn: string[];
}

/**
 * Column names whose VALUES are credentials rather than personal data.
 *
 * Matched by NAME PATTERN, not by an enumerated list, so a column added later
 * with an obviously credential-shaped name is redacted without anyone having to
 * remember this file. The pattern is deliberately broad: over-redacting a field
 * costs a reader one lookup, under-redacting one puts a live bearer token in a
 * file handed to a third party.
 *
 * `contentHash` and friends survive on purpose — a digest of a document the
 * subject signed is evidence about their own record, not a secret.
 */
const CREDENTIAL_KEY = /token|secret|password/i;
const REDACTED = '[redacted]';

function redact(rows: Row[]): Row[] {
    return rows.map((row) => {
        const out: Row = {};
        for (const [k, v] of Object.entries(row)) {
            out[k] = CREDENTIAL_KEY.test(k) && v != null ? REDACTED : v;
        }
        return out;
    });
}

/** Drizzle emits `IN ()` for an empty array, which SQLite rejects — every
 *  id-keyed query below is guarded rather than relying on that not happening. */
async function byIds(run: () => Promise<Row[]>, ids: string[]): Promise<Row[]> {
    return ids.length === 0 ? [] : run();
}

export async function assembleSubjectData(db: AnyDb, loc: SubjectLocator): Promise<SubjectDataset> {
    const { tenantId, subjectEmail } = loc;
    const phone = loc.subjectPhone?.trim() || undefined;
    const matchedOn: string[] = [];

    // ── Locate the subject ────────────────────────────────────────────────────
    // The CRM row is the spine: contact ids reach inspections, invoices,
    // payments and notification preferences, none of which carry an email.
    const contactRows: Row[] = await db.select().from(contacts)
        .where(and(
            eq(contacts.tenantId, tenantId),
            phone
                ? or(eq(contacts.email, subjectEmail), eq(contacts.phone, phone))
                : eq(contacts.email, subjectEmail),
        )).all();
    const contactIds = contactRows.map((c) => c.id as string);

    const peopleRows: Row[] = await byIds(() => db.select().from(inspectionPeople)
        .where(and(
            eq(inspectionPeople.tenantId, tenantId),
            inArray(inspectionPeople.contactId, contactIds),
        )).all(), contactIds);
    const inspectionIds = [...new Set(peopleRows.map((p) => p.inspectionId as string))];

    if (contactRows.length > 0) matchedOn.push('contacts');

    // ── Property + engagement record ─────────────────────────────────────────
    const inspectionRows = await byIds(() => db.select().from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), inArray(inspections.id, inspectionIds))).all(), inspectionIds);

    // The findings themselves. Included because an inspection report is a
    // document ABOUT the subject's property produced for them — withholding the
    // substance and disclosing only the envelope answers a narrower question
    // than the one Art. 15 asks.
    const resultRows = await byIds(() => db.select().from(inspectionResults)
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            inArray(inspectionResults.inspectionId, inspectionIds),
        )).all(), inspectionIds);

    const reportRows = await byIds(() => db.select().from(reports)
        .where(and(eq(reports.tenantId, tenantId), inArray(reports.inspectionId, inspectionIds))).all(), inspectionIds);

    // Public booking requests — the one place a phone is stored as a column of
    // its own, so the phone axis genuinely widens the match set here.
    const bookingRows: Row[] = await db.select().from(inspectionRequests)
        .where(and(
            eq(inspectionRequests.tenantId, tenantId),
            phone
                ? or(eq(inspectionRequests.clientEmail, subjectEmail), eq(inspectionRequests.clientPhone, phone))
                : eq(inspectionRequests.clientEmail, subjectEmail),
        )).all();
    if (bookingRows.length > 0) matchedOn.push('inspection_requests');

    // ── Agreements: the subject's OWN signer rows, plus the envelopes ────────
    const signerRows: Row[] = await db.select().from(agreementSigners)
        .where(and(eq(agreementSigners.tenantId, tenantId), eq(agreementSigners.email, subjectEmail))).all();
    const envelopeIds = [...new Set([
        ...signerRows.map((s) => s.requestId as string),
    ])];
    const byClient: Row[] = await db.select().from(agreementRequests)
        .where(and(eq(agreementRequests.tenantId, tenantId), eq(agreementRequests.clientEmail, subjectEmail))).all();
    const bySigner = await byIds(() => db.select().from(agreementRequests)
        .where(and(eq(agreementRequests.tenantId, tenantId), inArray(agreementRequests.id, envelopeIds))).all(), envelopeIds);
    const seenEnvelope = new Set<string>();
    const envelopeRows = [...byClient, ...bySigner].filter((e) => {
        const id = e.id as string;
        if (seenEnvelope.has(id)) return false;
        seenEnvelope.add(id);
        return true;
    });
    if (signerRows.length > 0 || envelopeRows.length > 0) matchedOn.push('agreements');

    // ── Money ────────────────────────────────────────────────────────────────
    const invoiceRows: Row[] = await db.select().from(invoices)
        .where(and(
            eq(invoices.tenantId, tenantId),
            contactIds.length > 0
                ? or(eq(invoices.clientEmail, subjectEmail), inArray(invoices.contactId, contactIds))
                : eq(invoices.clientEmail, subjectEmail),
        )).all();
    const invoiceIds = invoiceRows.map((i) => i.id as string);

    // Located BOTH ways, for the same reason the erasure step is: a deposit
    // taken before the invoice exists has no invoice_id, and a payment against a
    // standalone invoice has no inspection_id.
    const paymentReach = [
        ...(inspectionIds.length > 0 ? [inArray(orderPayments.inspectionId, inspectionIds)] : []),
        ...(invoiceIds.length > 0 ? [inArray(orderPayments.invoiceId, invoiceIds)] : []),
    ];
    const paymentRows: Row[] = paymentReach.length === 0 ? [] : await db.select().from(orderPayments)
        .where(and(
            eq(orderPayments.tenantId, tenantId),
            paymentReach.length === 1 ? paymentReach[0] : or(...paymentReach),
        )).all();

    // ── Delivery + portal access ─────────────────────────────────────────────
    const tokenRows: Row[] = await db.select().from(inspectionAccessTokens)
        .where(and(
            eq(inspectionAccessTokens.tenantId, tenantId),
            eq(inspectionAccessTokens.recipientEmail, subjectEmail),
        )).all();
    const tokenIds = tokenRows.map((t) => t.id as string);
    const viewRows = await byIds(() => db.select().from(reportViews)
        .where(and(eq(reportViews.tenantId, tenantId), inArray(reportViews.accessTokenId, tokenIds))).all(), tokenIds);

    const conciergeRows: Row[] = await db.select().from(conciergeConfirmTokens)
        .where(and(
            eq(conciergeConfirmTokens.tenantId, tenantId),
            eq(conciergeConfirmTokens.clientEmail, subjectEmail),
        )).all();

    // ── Prose the subject themselves wrote ───────────────────────────────────
    // `created_by_ref` holds the actor's EMAIL on the portal-token path (how a
    // client always arrives) — see the schema comment on `repair_requests`.
    const repairRows: Row[] = await db.select().from(repairRequests)
        .where(and(eq(repairRequests.tenantId, tenantId), eq(repairRequests.createdByRef, subjectEmail))).all();
    const repairIds = repairRows.map((r) => r.id as string);
    const repairItemRows = await byIds(() => db.select().from(repairRequestItems)
        .where(and(
            eq(repairRequestItems.tenantId, tenantId),
            inArray(repairRequestItems.repairRequestId, repairIds),
        )).all(), repairIds);

    // ── Stated preferences and contact-suppression state ─────────────────────
    const prefRows = await byIds(() => db.select().from(notificationPreferences)
        .where(and(
            eq(notificationPreferences.tenantId, tenantId),
            eq(notificationPreferences.subjectKind, 'contact'),
            inArray(notificationPreferences.subjectId, contactIds),
        )).all(), contactIds);

    const suppressionRows: Row[] = await db.select().from(emailSuppressions)
        .where(and(eq(emailSuppressions.tenantId, tenantId), eq(emailSuppressions.email, subjectEmail))).all();

    // `recipient` holds the email on email rows and the E.164 phone on SMS rows
    // — one column, two axes, which is why the phone match is applied to it.
    const automationRows: Row[] = await db.select().from(automationLogs)
        .where(and(
            eq(automationLogs.tenantId, tenantId),
            phone
                ? or(eq(automationLogs.recipient, subjectEmail), eq(automationLogs.recipient, phone))
                : eq(automationLogs.recipient, subjectEmail),
        )).all();
    if (phone && automationRows.some((a) => a.recipient === phone)) matchedOn.push('automation_logs (phone)');

    // ── Accountability records ───────────────────────────────────────────────
    const auditTargets = [...inspectionIds, ...contactIds];
    const auditRows = await byIds(() => db.select().from(auditLogs)
        .where(and(eq(auditLogs.tenantId, tenantId), inArray(auditLogs.entityId, auditTargets))).all(), auditTargets);

    // Prior erasure decisions about this same subject. A subject who asks what
    // is held is entitled to see that a previous request was acted on.
    const erasureRows: Row[] = await db.select().from(erasureLog)
        .where(and(eq(erasureLog.tenantId, tenantId), eq(erasureLog.subjectEmail, subjectEmail))).all();

    const collections: Record<string, Row[]> = {
        contacts: contactRows,
        inspection_people: peopleRows,
        inspections: inspectionRows,
        inspection_results: resultRows,
        reports: reportRows,
        inspection_requests: bookingRows,
        agreement_requests: redact(envelopeRows),
        agreement_signers: signerRows,
        invoices: invoiceRows,
        order_payments: paymentRows,
        inspection_access_tokens: redact(tokenRows),
        report_views: viewRows,
        concierge_confirm_tokens: redact(conciergeRows),
        repair_requests: redact(repairRows),
        repair_request_items: repairItemRows,
        notification_preferences: prefRows,
        email_suppressions: suppressionRows,
        automation_logs: automationRows,
        audit_logs: auditRows,
        erasure_log: erasureRows,
    };

    const rows = Object.values(collections).reduce((n, r) => n + r.length, 0);
    return { collections, inspectionIds, contactIds, rows, matchedOn };
}
