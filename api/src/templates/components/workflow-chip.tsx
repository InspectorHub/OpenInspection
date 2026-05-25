/**
 * Design System 0520 subsystem B phase 6 task 6.6 — WorkflowChip.
 *
 * Pure JSX primitive. Renders a coloured pill for an item / section's
 * current workflow state. Used inline in inspection rows + report
 * card stack to surface "agreement pending" / "payment due" /
 * "apprentice review" tags without a runtime data fetch.
 *
 * Apprentice-review tone is a stub on this PR — populated by
 * subsystem C M5 when ApprenticeReview lands. The chip itself renders
 * fine even if no consumer dispatches that state yet.
 */

type WorkflowState =
    | 'agreement'
    | 'payment'
    | 'apprentice-review'
    | 'published'
    | 'cancelled'
    | 'draft';

const STATE_LABELS: Record<WorkflowState, string> = {
    'agreement':         'Agreement',
    'payment':           'Payment',
    'apprentice-review': 'Apprentice review',
    'published':         'Published',
    'cancelled':         'Cancelled',
    'draft':             'Draft',
};

// Maps each workflow state to the canonical .ih-pill tone class set up
// in subsystem A phase 1 token sync (sat/monitor/defect/info/gen/ni/np).
const STATE_TONES: Record<WorkflowState, string> = {
    'agreement':         'ih-pill--monitor',     // amber — waiting on user
    'payment':           'ih-pill--info',        // sky — informational gate
    'apprentice-review': 'ih-pill--monitor',     // amber — pending mentor
    'published':         'ih-pill--sat',         // green — final
    'cancelled':         'ih-pill--defect',      // rose — terminated
    'draft':             'ih-pill--gen',         // slate — neutral
};

export function WorkflowChip({ state, label }: { state: WorkflowState; label?: string }): JSX.Element {
    const tone = STATE_TONES[state] ?? STATE_TONES.draft;
    const text = label ?? STATE_LABELS[state] ?? STATE_LABELS.draft;
    return (
        <span class={`ih-pill ${tone}`} aria-label={`Workflow state: ${text}`}>{text}</span>
    );
}
