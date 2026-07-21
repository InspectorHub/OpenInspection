/**
 * Issue #111 — pure helpers for the `/inspections/:id` hub page.
 *
 * `deriveBlockStates(hub)` collapses the aggregate hub payload into the three
 * status pills the page renders (agreement / invoice / report). It is a pure
 * function with no React or network dependency so every status branch is unit
 * testable in isolation (see tests/web/unit/inspection-hub.spec.ts).
 *
 * `formatCents` is the cents → "$X.XX" formatter used by the Services block.
 * It delegates to the shared locale-aware formatter; locale/currency default to
 * en-US/USD (behavior-preserving) and callers thread the viewer values when known.
 */

import { INSPECTION_STATUS, isReportPublished } from '~/lib/status';
import { formatCurrency } from '~/lib/format';
import { m } from '~/paraglide/messages';

/**
 * Pill tone union — kept in sync with packages/shared-ui/src/Pill.tsx.
 * @public — consumed via an inline `import("~/lib/hub-blocks").PillTone` type
 * reference in inspection-hub.tsx, which knip cannot trace (dynamic-import blind spot).
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

/**
 * The subset of the `/api/inspections/{id}/hub` payload that block derivation
 * reads. The full payload (people, services, agreements, tenantSlug, …) is
 * typed by the loader; this slice is all `deriveBlockStates` needs, which keeps
 * the helper — and its tests — decoupled from the wider schema.
 */
export interface HubPayload {
    inspection: {
        status: string;
        reportStatus: string;
        paymentRequired: boolean;
        agreementRequired: boolean;
    };
    agreementRequests: Array<{
        id: string;
        status: string;
        clientEmail: string;
        signedAt: string | null;
        createdAt: string | null;
    }>;
    invoice: {
        id: string;
        status: string;
        amountCents: number;
        sentAt: string | null;
        paidAt: string | null;
    } | null;
    publishReadiness: {
        ready: boolean;
        blockingCount: number;
    };
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
 * True only when the inspection is `completed` AND the report is not already
 * published. The `completed` gate excludes cancelled / requested / in-progress
 * regardless of report status.
 */
export function canPublish(hub: HubPayload): boolean {
    return hub.inspection.status === INSPECTION_STATUS.COMPLETED && !isReportPublished(hub.inspection.reportStatus);
}

/** Whether the report has already been shipped to the client (read-only state). */
export function isReportShipped(hub: HubPayload): boolean {
    return isReportPublished(hub.inspection.reportStatus);
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
