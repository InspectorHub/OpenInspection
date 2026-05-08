/**
 * Sprint 1 Sub-spec D Task 4 (D-7) — Report status pill.
 *
 * Renders a canonical `.ih-pill` (24 px tall, radius 4) with a tiny dot
 * indicator. Used by the report viewer top-right and the agent dashboard
 * to show the inspection's lifecycle state at a glance.
 *
 * Status enum maps to the existing pill modifiers:
 *  draft           -> .ih-pill--gen     (slate)
 *  pending_review  -> .ih-pill--monitor (amber)
 *  published       -> .ih-pill--sat     (emerald)
 *  viewed_client   -> .ih-pill--info    (indigo)
 *  viewed_agent    -> .ih-pill--info    (indigo)
 */

export type ReportStatus = 'draft' | 'pending_review' | 'published' | 'viewed_client' | 'viewed_agent';

interface StatusMeta {
    label: string;
    pillClass: string;
}

const STATUS_META: Record<ReportStatus, StatusMeta> = {
    draft:           { label: 'Draft',            pillClass: 'ih-pill--gen' },
    pending_review:  { label: 'Pending review',   pillClass: 'ih-pill--monitor' },
    published:       { label: 'Published',        pillClass: 'ih-pill--sat' },
    viewed_client:   { label: 'Viewed by client', pillClass: 'ih-pill--info' },
    viewed_agent:    { label: 'Viewed by agent',  pillClass: 'ih-pill--info' },
};

const FALLBACK: StatusMeta = STATUS_META.draft;

/**
 * Resolve any string status to a known meta entry. Anything we don't
 * recognise falls back to "Draft" so the pill never breaks the layout.
 */
function resolveMeta(status: string): StatusMeta {
    return (STATUS_META as Record<string, StatusMeta | undefined>)[status] ?? FALLBACK;
}

export const ReportStatusPill = ({ status }: { status: string }): JSX.Element => {
    const meta = resolveMeta(status);
    return (
        <span class={`ih-pill ${meta.pillClass}`} aria-label={`Report status: ${meta.label}`}>
            <span class="w-1.5 h-1.5 rounded-full bg-current opacity-60 mr-1" aria-hidden="true"></span>
            {meta.label}
        </span>
    );
};
