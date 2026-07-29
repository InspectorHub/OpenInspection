/**
 * Issue #111 — pure helpers for the `/inspections/:id` hub page.
 *
 * `deriveBlockStates(hub)` collapses the aggregate hub payload into the three
 * status pills the page renders (agreement / invoice / report). It is a pure
 * function with no React or network dependency so every status branch is unit
 * testable in isolation (see tests/unit/inspections/inspector-portal.spec.ts).
 *
 * `formatCents` is the cents → "$X.XX" formatter used by the Services block.
 * It delegates to the shared locale-aware formatter; locale/currency default to
 * en-US/USD (behavior-preserving) and callers thread the viewer values when known.
 */

import { isReportPublished, INSPECTION_STATUS } from '~/lib/status';
import { formatCurrency } from '~/lib/format';
import { m } from '~/paraglide/messages';
// Type-only — erased at build, so the API's zod module never reaches the client
// bundle. This is the single source of truth for the hub payload's shape.
import type { z } from '@hono/zod-openapi';
import type { InspectionHubSchema } from '../../server/lib/validations/inspection/read';

/**
 * Pill tone union — kept in sync with packages/shared-ui/src/Pill.tsx.
 * @public — consumed via an inline `import("~/lib/hub-blocks").PillTone` type
 * reference in inspector-portal.tsx, which knip cannot trace (dynamic-import blind spot).
 */
export type PillTone =
    | 'sat'
    | 'monitor'
    | 'defect'
    | 'ni'
    | 'np'
    | 'info'
    | 'gen'
    | 'primary'
    | 'neutral'
    | 'warning';

/** A single derived status pill: a tone + a human-readable label. */
interface BlockState {
    tone: PillTone;
    label: string;
}

/** Derived states for the three action-bearing blocks. */
export interface BlockStates {
    agreement: BlockState;
    invoice: BlockState;
    report: BlockState;
}

/** The wire payload of `GET /api/inspections/{id}/hub`, from its own schema. */
type Hub = z.infer<typeof InspectionHubSchema>;

/**
 * The subset of the hub payload that block derivation reads.
 *
 * DERIVED, never hand-copied: every block below is indexed out of the server
 * schema, so a field added or renamed there is a compile error here instead of
 * a silent divergence. (It used to be a hand-written mirror; adding
 * `invoice.payUrl` server-side left this copy stale until tsc caught it, and an
 * OPTIONAL field would have slipped through entirely.)
 *
 * `inspection` stays a deliberate narrow slice — `deriveBlockStates` reads four
 * fields and its fixtures should not have to build the whole inspection row.
 * `Pick` keeps that decoupling while still failing the build if one of those
 * four is renamed. The other three blocks track the schema exactly.
 */
export interface HubPayload {
    inspection: Pick<Hub['inspection'], 'status' | 'reportStatus' | 'paymentRequired' | 'agreementRequired'>;
    agreementRequests: Hub['agreementRequests'];
    invoice: Hub['invoice'];
    publishReadiness: Hub['publishReadiness'];
}

/* ------------------------------------------------------------------ */
/*  Per-block derivation                                               */
/* ------------------------------------------------------------------ */

/**
 * Agreement pill. The payload lists requests newest-first, so the newest
 * request's status drives the pill. With no requests we distinguish "agreement
 * not gating this inspection" (neutral) from "gated but nothing sent yet"
 * (warning).
 */
function deriveAgreement(hub: HubPayload): BlockState {
    const newest = hub.agreementRequests[0];
    if (!newest) {
        return hub.inspection.agreementRequired
            ? { tone: 'warning', label: m.label_hub_agreement_not_sent() }
            : { tone: 'neutral', label: m.label_hub_agreement_not_required() };
    }
    switch (newest.status) {
        case 'pending':
        case 'sent':
            return { tone: 'monitor', label: m.label_hub_agreement_awaiting_signature() };
        case 'viewed':
            return { tone: 'monitor', label: m.label_hub_agreement_viewed() };
        case 'signed':
            return { tone: 'sat', label: m.label_hub_agreement_signed() };
        case 'declined':
            return { tone: 'defect', label: m.label_hub_agreement_declined() };
        case 'expired':
            return { tone: 'warning', label: m.label_hub_agreement_expired() };
        default:
            // Unknown status — treat as still-awaiting rather than crash.
            return { tone: 'monitor', label: m.label_hub_agreement_awaiting_signature() };
    }
}

/**
 * Invoice pill. With no invoice we distinguish "payment not gating this
 * inspection" (neutral) from "gated but not invoiced yet" (warning); otherwise
 * the invoice's own status drives the pill (money authority chain tier 1).
 */
function deriveInvoice(hub: HubPayload): BlockState {
    const inv = hub.invoice;
    if (!inv) {
        return hub.inspection.paymentRequired
            ? { tone: 'warning', label: m.label_hub_invoice_not_invoiced() }
            : { tone: 'neutral', label: m.label_hub_invoice_none() };
    }
    switch (inv.status) {
        case 'draft':
            return { tone: 'neutral', label: m.label_hub_invoice_draft() };
        case 'sent':
            return { tone: 'monitor', label: m.label_hub_invoice_awaiting_payment() };
        case 'partial':
            return { tone: 'warning', label: m.label_hub_invoice_partially_paid() };
        case 'paid':
            return { tone: 'sat', label: m.label_hub_invoice_paid() };
        default:
            return { tone: 'neutral', label: m.label_hub_invoice_draft() };
    }
}

/** Report deliverable pill (report axis). */
function deriveReportPill(reportStatus: string): BlockState {
    switch (reportStatus) {
        case 'in_progress': return { tone: 'neutral', label: m.label_hub_report_in_progress() };
        case 'submitted':   return { tone: 'warning', label: m.label_hub_report_submitted() };
        case 'published':   return { tone: 'sat',     label: m.label_hub_report_published() };
        default:            return { tone: 'neutral', label: m.label_hub_report_in_progress() };
    }
}

function deriveReport(hub: HubPayload): BlockState {
    return deriveReportPill(hub.inspection.reportStatus);
}

/** Collapse the hub payload into the three action-block status pills. */
export function deriveBlockStates(hub: HubPayload): BlockStates {
    return {
        agreement: deriveAgreement(hub),
        invoice: deriveInvoice(hub),
        report: deriveReport(hub),
    };
}

/* ------------------------------------------------------------------ */
/*  Publish affordance                                                 */
/* ------------------------------------------------------------------ */

/**
 * Whether the hub Report card should offer an active "Publish report" button.
 * Reads the report axis only: anything not yet published can be published.
 * The order lifecycle (requested → … → completed) tracks the job rather than
 * the report and the API does not gate publication on it, so gating here would
 * only hide an action the server would have accepted.
 */
export function canPublish(hub: HubPayload): boolean {
    return !isReportPublished(hub.inspection.reportStatus);
}

/**
 * Whether the report has already been shipped to the client (read-only state).
 * The exact complement of `canPublish` — stated as such so the two can never
 * drift into disagreeing about the same report.
 */
export function isReportShipped(hub: HubPayload): boolean {
    return !canPublish(hub);
}

/**
 * The newest instant any version of this report was published (unix seconds), or
 * null when none has been.
 *
 * Takes the minimum slice of a version row rather than the route's
 * ReportVersionRow, for the same reason HubPayload is a slice: this helper and its
 * tests stay decoupled from the wider schema.
 */
export function latestPublishedAt(versions: Array<{ publishedAt: number | null }>): number | null {
    const stamps = versions.map((v) => v.publishedAt).filter((t): t is number => typeof t === 'number');
    return stamps.length ? Math.max(...stamps) : null;
}

/**
 * Who publishing actually emailed, read off the submitted publish form.
 *
 * The hub payload records that a report is published; it records nothing about
 * delivery. Publishing takes `notifyClient` / `notifyAgent` checkboxes, so the
 * form is the only place the answer exists — and 'none' is a real outcome, not an
 * error: an inspector may publish to have the link, and send it later.
 */
export function publishNotified(flags: {
    notifyClient?: boolean | undefined;
    notifyAgent?: boolean | undefined;
}): 'both' | 'client' | 'agent' | 'none' {
    const client = flags.notifyClient === true;
    const agent = flags.notifyAgent === true;
    if (client && agent) return 'both';
    if (client) return 'client';
    if (agent) return 'agent';
    return 'none';
}

/**
 * The party an invoice is FROM.
 *
 * This is who the client owes, so it may not be filled with a placeholder: the
 * field previously read "Your inspector" whenever the invoice carried no
 * inspector name, which looks like an answer and is not one. The company is the
 * correct substitute, and an em dash is what remains when the document names
 * nobody — matching the BILL TO field beside it.
 */
export function invoiceFromParty(
    inspectorName: string | null | undefined,
    companyName: string | null | undefined,
): string {
    return inspectorName?.trim() || companyName?.trim() || '—';
}

/* ------------------------------------------------------------------ */
/*  Money formatting                                                   */
/* ------------------------------------------------------------------ */

/** Format integer cents as a currency string, e.g. 50000 → "$500.00".
 *  locale/currency default to en-US/USD; callers pass the viewer values to localize. */
export function formatCents(
    cents: number | null | undefined,
    opts?: { locale?: string; currency?: string },
): string {
    return formatCurrency(cents ?? 0, { locale: opts?.locale ?? 'en-US', currency: opts?.currency ?? 'USD' });
}

/**
 * What the hub's status card should say.
 *
 * `actionable` still offers "Mark fieldwork complete"; the two terminal states
 * do not, and used to render nothing in its place — leaving a card whose entire
 * content was a heading and a status pill above blank space. They are also not
 * the same statement: completed means the visit happened, cancelled means it will
 * not. An unrecognised status is treated as actionable rather than blank, so a
 * status added later cannot silently hide the only control on the card.
 */
export function lifecycleState(status: string): "actionable" | "completed" | "cancelled" {
    if (status === INSPECTION_STATUS.COMPLETED) return "completed";
    if (status === INSPECTION_STATUS.CANCELLED) return "cancelled";
    return "actionable";
}
