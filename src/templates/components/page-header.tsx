/**
 * PageHeader — canonical page-level header for every list/admin page.
 *
 * Sprint 1 Sub-spec B Task 1. Replaces the bespoke eyebrow/h1/lead block that
 * each page rolled by hand. Enforces:
 *   - 22px font-bold tracking-tight H1 (canonical --ih-text-section)
 *   - 5-color eyebrow enum (slate / indigo / emerald / amber / rose) — semantic, not arbitrary
 *   - real meta data (no "Manage your X" filler副标题 — that pattern is banned)
 *   - optional breadcrumb + optional BackButton + optional actions slot
 *
 * Design system reference: docs/superpowers/plans/2026-05-08-sprint1-design-system-reference.md
 */

import { Breadcrumb, type BreadcrumbItem } from './breadcrumb';
import { BackButton } from './back-button';

export type EyebrowColor = 'slate' | 'indigo' | 'emerald' | 'amber' | 'rose';

const EYEBROW_TONE: Record<EyebrowColor, string> = {
    slate:   'bg-slate-100   text-slate-600   ring-slate-200',
    indigo:  'bg-indigo-50   text-indigo-600  ring-indigo-200',
    emerald: 'bg-emerald-50  text-emerald-600 ring-emerald-200',
    amber:   'bg-amber-50    text-amber-600   ring-amber-200',
    rose:    'bg-rose-50     text-rose-600    ring-rose-200',
};

export interface PageHeaderProps {
    eyebrow?:      string;
    eyebrowColor?: EyebrowColor;
    /** Title accepts JSX so pages can wire dynamic Alpine bindings
     *  (e.g. `<span x-text="dashTitle">Dashboard</span>`) for time-aware
     *  greetings without losing the canonical 22px typography. */
    title:         string | JSX.Element;
    meta?:         JSX.Element | string;
    breadcrumb?:   BreadcrumbItem[];
    actions?:      JSX.Element;
    showBack?:     boolean;
}

export const PageHeader = ({
    eyebrow,
    eyebrowColor = 'slate',
    title,
    meta,
    breadcrumb,
    actions,
    showBack = false,
}: PageHeaderProps): JSX.Element => {
    return (
        <header class="space-y-3">
            {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
            {showBack && breadcrumb && breadcrumb.length >= 2 && <BackButton items={breadcrumb} />}
            <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div class="space-y-2 min-w-0 flex-1">
                    {eyebrow && (
                        <span class={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ring-1 ring-inset text-[10px] font-bold uppercase tracking-[0.2em] ${EYEBROW_TONE[eyebrowColor]}`}>
                            <span class="w-1 h-1 rounded-full bg-current opacity-60" aria-hidden="true"></span>
                            {eyebrow}
                        </span>
                    )}
                    <h1 class="text-[22px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight truncate">{title}</h1>
                    {meta && (
                        <div class="text-[13px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                            {meta}
                        </div>
                    )}
                </div>
                {actions && <div class="flex items-center gap-2 flex-shrink-0">{actions}</div>}
            </div>
        </header>
    );
};
