/**
 * Round-2 F2 — Inspection list status-icon helper.
 *
 * Translates the dashboard-bucket statusFlags shape into the four visual
 * indicators rendered next to each inspection row:
 *
 *   - 📄 report ready      → status is `completed` or `delivered`
 *   - 📋 agreement signed  → at least one signed agreement_requests envelope
 *   - ✈️ sent              → status is `delivered` (publish workflow ran)
 *   - 🚩 flag              → row is in the "Needs Attention" bucket
 *                            (e.g. agreement unsigned past threshold,
 *                            invoice overdue, report unpublished too long)
 *
 * Pure function: input is the minimal subset of inspection-row fields the
 * dashboard already loads, output is a 4-key boolean record. Easy to unit
 * test with a state matrix and reuse anywhere a row needs the icons.
 */

export interface InspectionStatusInput {
    /** Inspection lifecycle status (`draft`, `scheduled`, `confirmed`, `in_progress`, `completed`, `delivered`, `cancelled`). */
    status?: string | null;
    /** Has at least one signed agreement record. */
    agreementSigned?: boolean;
    /** Row currently sits in the Needs Attention bucket. */
    flagged?: boolean;
}

export interface InspectionStatusIcons {
    /** Report has been built (rated + published). */
    reportReady: boolean;
    /** Inspection agreement was signed by the client. */
    agreementSigned: boolean;
    /** Publish workflow completed — report has been delivered to recipients. */
    sent: boolean;
    /** Row needs attention (overdue or stale). */
    flagged: boolean;
}

/**
 * Computes the four status-icon states for one inspection row.
 *
 * Defensive: missing fields collapse to `false` so partial data (e.g. a row
 * pulled before signed-agreements join lands) never throws.
 */
export function getInspectionStatusIcons(input: InspectionStatusInput): InspectionStatusIcons {
    const status = (input.status ?? '').toLowerCase();
    const completedOrDelivered = status === 'completed' || status === 'delivered';
    const delivered            = status === 'delivered';
    return {
        reportReady:     completedOrDelivered,
        agreementSigned: input.agreementSigned === true,
        sent:            delivered,
        flagged:         input.flagged === true,
    };
}
