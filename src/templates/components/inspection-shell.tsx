/**
 * Sprint 2 S2-5 — Inspection sub-route shell.
 *
 * All five inspection sub-routes (`/report`, `/photos`, `/summary`,
 * `/signatures`, `/settings`) share this chrome. It renders:
 *   - PageHeader with breadcrumb + property address as title
 *   - Optional "Part X of Y in request ABC" badge with sibling switcher
 *     (S2-2 integration — only shown when the inspection has a request_id
 *     with > 1 sibling)
 *   - Sticky horizontal sub-nav with 5 tabs
 *   - Slot for the active sub-page
 *
 * Re-uses Sprint 1 PageHeader / Breadcrumb primitives so design tokens stay
 * consistent across the app.
 */

import { PageHeader } from './page-header';

export type InspectionSubRoute = 'report' | 'photos' | 'summary' | 'signatures' | 'settings';

interface SubInspectionInfo {
    id:           string;
    templateName: string;
    status:       string;
}

export interface InspectionShellProps {
    inspectionId:    string;
    propertyAddress: string;
    current:         InspectionSubRoute;
    /** When set, the page header shows a "Part X of Y" badge with switcher. */
    requestId?:      string;
    siblings?:       SubInspectionInfo[];
    children:        unknown;
}

const TABS: Array<{ id: InspectionSubRoute; label: string }> = [
    { id: 'report',     label: 'Report' },
    { id: 'photos',     label: 'Photos' },
    { id: 'summary',    label: 'Summary' },
    { id: 'signatures', label: 'Signatures' },
    { id: 'settings',   label: 'Settings' },
];

export const InspectionShell = ({
    inspectionId,
    propertyAddress,
    current,
    requestId,
    siblings,
    children,
}: InspectionShellProps): JSX.Element => {
    const hasMultipleSiblings = !!siblings && siblings.length > 1;
    const partIndex = hasMultipleSiblings && siblings
        ? siblings.findIndex(s => s.id === inspectionId) + 1
        : 0;
    const partTotal = siblings?.length ?? 0;

    return (
        <div class="space-y-6">
            <PageHeader
                breadcrumb={[
                    { label: 'Inspections', href: '/dashboard' },
                    { label: propertyAddress || 'Inspection' },
                ]}
                title={propertyAddress || 'Inspection'}
                showBack={true}
                {...(hasMultipleSiblings && requestId
                    ? {
                        meta: (
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 ring-1 ring-inset ring-indigo-200 text-[11px] font-bold text-indigo-700">
                                    Part {partIndex} of {partTotal}
                                </span>
                                <span class="text-[12px] text-slate-500">
                                    in request <span class="font-mono font-semibold text-slate-700">{requestId.slice(0, 8)}</span>
                                </span>
                            </div>
                        ),
                    }
                    : {})}
            />

            {/* Sibling switcher (S2-2): one chip per sub-inspection. */}
            {hasMultipleSiblings && siblings && (
                <nav
                    aria-label="Sibling inspections"
                    class="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 rounded-md border border-slate-200"
                >
                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                        Same visit
                    </span>
                    {siblings.map((s) => {
                        const isCurrent = s.id === inspectionId;
                        return (
                            <a
                                href={`/inspections/${s.id}/${current}`}
                                class={isCurrent
                                    ? 'px-2.5 py-1 rounded-md bg-white border border-indigo-300 text-indigo-700 text-[11px] font-bold'
                                    : 'px-2.5 py-1 rounded-md text-slate-600 text-[11px] font-medium hover:bg-white hover:text-slate-900 transition-colors'}
                                aria-current={isCurrent ? 'page' : undefined}
                            >
                                {s.templateName}
                            </a>
                        );
                    })}
                </nav>
            )}

            {/* Sub-route nav (5 tabs). */}
            <nav
                role="tablist"
                aria-label="Inspection sections"
                class="border-b border-slate-200 sticky top-0 z-20 bg-[#f8fafc]"
            >
                <div class="flex items-center gap-1 overflow-x-auto hide-scrollbar">
                    {TABS.map((t) => {
                        const active = t.id === current;
                        return (
                            <a
                                href={`/inspections/${inspectionId}/${t.id}`}
                                role="tab"
                                aria-current={active ? 'page' : undefined}
                                aria-selected={active ? 'true' : 'false'}
                                class={active
                                    ? 'px-4 py-3 text-[13px] font-bold border-b-2 border-indigo-500 text-slate-900 whitespace-nowrap'
                                    : 'px-4 py-3 text-[13px] font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300 whitespace-nowrap transition-colors'}
                            >
                                {t.label}
                            </a>
                        );
                    })}
                </div>
            </nav>

            <div>{children}</div>
        </div>
    );
};
