/**
 * Issue #111 — pure helpers for the `/inspections/:id` hub page.
 *
 * `deriveBlockStates(hub)` collapses the aggregate hub payload into the three
 * status pills the page renders (agreement / invoice / report). It is a pure
 * function with no React or network dependency so every status branch is unit
 * testable in isolation (see tests/web/unit/inspection-hub.spec.ts).
 *
 * `formatCents` is the cents → "$X.XX" formatter used by the Services block.
 * (No shared cents formatter lives in app/lib yet; this mirrors the
 * Intl.NumberFormat usage in routes/invoices.tsx.)
 */

/** Pill tone union — kept in sync with packages/shared-ui/src/Pill.tsx. */
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
export interface BlockState {
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
            ? { tone: 'warning', label: 'Not sent' }
            : { tone: 'neutral', label: 'Not required' };
    }
    switch (newest.status) {
        case 'pending':
        case 'sent':
            return { tone: 'monitor', label: 'Awaiting signature' };
        case 'viewed':
            return { tone: 'monitor', label: 'Viewed' };
        case 'signed':
            return { tone: 'sat', label: 'Signed' };
        case 'declined':
            return { tone: 'defect', label: 'Declined' };
        case 'expired':
            return { tone: 'warning', label: 'Expired' };
        default:
            // Unknown status — treat as still-awaiting rather than crash.
            return { tone: 'monitor', label: 'Awaiting signature' };
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
            ? { tone: 'warning', label: 'Not invoiced' }
            : { tone: 'neutral', label: 'No invoice' };
    }
    switch (inv.status) {
        case 'draft':
            return { tone: 'neutral', label: 'Draft' };
        case 'sent':
            return { tone: 'monitor', label: 'Awaiting payment' };
        case 'partial':
            return { tone: 'warning', label: 'Partially paid' };
        case 'paid':
            return { tone: 'sat', label: 'Paid' };
        default:
            return { tone: 'neutral', label: 'Draft' };
    }
}

/**
 * Report pill. Pre-completion statuses are all "in progress"; once completed
 * the publish-readiness gate decides ready-vs-blocked; delivered/published is
 * the terminal "published" state.
 */
function deriveReport(hub: HubPayload): BlockState {
    const { status } = hub.inspection;
    switch (status) {
        case 'draft':
        case 'scheduled':
        case 'confirmed':
        case 'in_progress':
            return { tone: 'neutral', label: 'In progress' };
        case 'completed':
            return hub.publishReadiness.ready
                ? { tone: 'monitor', label: 'Ready to publish' }
                : { tone: 'warning', label: `${hub.publishReadiness.blockingCount} blocker(s)` };
        case 'delivered':
        case 'published':
            return { tone: 'sat', label: 'Published' };
        case 'signed':
            return { tone: 'info', label: 'Signed' };
        case 'cancelled':
            return { tone: 'defect', label: 'Cancelled' };
        default:
            return { tone: 'neutral', label: 'In progress' };
    }
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
 * Statuses where the report is already shipped to the client — no publish CTA.
 * `delivered` is the only LIVE inspection status here (the lifecycle enum is
 * `draft | completed | delivered`; publishInspection transitions to
 * `delivered`). `published` / `signed` are retained DEFENSIVELY, mirroring the
 * dashboard's `matchesWorkflow` published-tab matching — they are not produced
 * as inspection.status today but cost nothing to tolerate if that changes.
 */
const PUBLISHED_STATUSES = new Set(['delivered', 'published', 'signed']);

/**
 * Task 9 (Issue #111) — whether the hub Report card should offer an ACTIVE
 * "Publish report" button. True only when the inspection is `completed` (the
 * only status from which publishing is legitimate) AND publish-ready AND not
 * already shipped. The `completed` gate excludes cancelled / draft / in_progress
 * regardless of readiness, so a stale `ready` flag can never offer a Publish CTA
 * for a cancelled inspection. A non-ready completed report shows the disabled
 * button + a blockers hint; an already-shipped report shows read-only state +
 * the header View link.
 */
export function canPublish(hub: HubPayload): boolean {
    if (PUBLISHED_STATUSES.has(hub.inspection.status)) return false;
    if (hub.inspection.status !== 'completed') return false;
    return hub.publishReadiness.ready;
}

/** Whether the report has already been shipped to the client (read-only state). */
export function isReportShipped(hub: HubPayload): boolean {
    return PUBLISHED_STATUSES.has(hub.inspection.status);
}

/* ------------------------------------------------------------------ */
/*  Money formatting                                                   */
/* ------------------------------------------------------------------ */

const CENTS_FORMATTER = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

/** Format integer cents as a US-currency string, e.g. 50000 → "$500.00". */
export function formatCents(cents: number | null | undefined): string {
    return CENTS_FORMATTER.format((cents ?? 0) / 100);
}
