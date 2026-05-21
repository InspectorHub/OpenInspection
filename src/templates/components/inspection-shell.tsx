/**
 * Sprint 2 S2-5 — Inspection sub-route shell.
 *
 * Inspection sub-routes (`/report`, `/photos`, `/signatures`,
 * `/settings`) share this chrome. It renders:
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

export type InspectionSubRoute = 'report' | 'settings' | 'repair-list';

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
    /** Track E1 — when true, the sub-nav exposes a 6th "Repair List" tab. */
    enableRepairList?: boolean;
    children:        unknown;
}

const TABS: Array<{ id: InspectionSubRoute; label: string }> = [
    { id: 'report',      label: 'Report' },
    { id: 'repair-list', label: 'Repair List' },
    { id: 'settings',    label: 'Settings' },
];

export const InspectionShell = ({
    inspectionId,
    propertyAddress,
    current,
    requestId,
    siblings,
    enableRepairList = false,
    children,
}: InspectionShellProps): JSX.Element => {
    // Track E1 — Repair List tab is opt-in per tenant. Filter it out when
    // disabled so the sub-nav stays at its 5-tab Sprint 2 baseline.
    const visibleTabs = enableRepairList ? TABS : TABS.filter(t => t.id !== 'repair-list');
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
                    class="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700"
                >
                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        Same visit
                    </span>
                    {siblings.map((s) => {
                        const isCurrent = s.id === inspectionId;
                        return (
                            <a
                                href={`/inspections/${s.id}/${current}`}
                                class={isCurrent
                                    ? 'px-2.5 py-1 rounded-md bg-white dark:bg-slate-700 border border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold'
                                    : 'px-2.5 py-1 rounded-md text-slate-600 dark:text-slate-400 text-[11px] font-medium hover:bg-white dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors'}
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
                class="border-b border-slate-200 dark:border-slate-700 sticky top-0 z-20 bg-[#f8fafc] dark:bg-slate-900"
            >
                <div class="flex items-center gap-1 overflow-x-auto hide-scrollbar">
                    {visibleTabs.map((t) => {
                        const active = t.id === current;
                        return (
                            <a
                                href={`/inspections/${inspectionId}/${t.id}`}
                                role="tab"
                                aria-current={active ? 'page' : undefined}
                                aria-selected={active ? 'true' : 'false'}
                                class={active
                                    ? 'px-4 py-3 text-[13px] font-bold border-b-2 border-indigo-500 text-slate-900 dark:text-slate-100 whitespace-nowrap'
                                    : 'px-4 py-3 text-[13px] font-bold border-b-2 border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600 whitespace-nowrap transition-colors'}
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
