/**
 * BackButton — opt-in ghost button that walks one step up the breadcrumb trail.
 *
 * Defaults to the penultimate breadcrumb item. Falls back to fallbackHref or
 * /dashboard if no breadcrumb supplied.
 *
 * Used on detail pages (inspection-edit, agreement-sign, report viewer)
 * where keyboard "go back" is critical.
 */

import type { BreadcrumbItem } from './breadcrumb';

export interface BackButtonProps {
    items?:        BreadcrumbItem[];
    fallbackHref?: string;
}

export const BackButton = ({ items, fallbackHref }: BackButtonProps): JSX.Element => {
    const target = items && items.length >= 2 ? items[items.length - 2] : null;
    const href = target?.href || fallbackHref || '/dashboard';
    const label = target?.label || 'Back';
    return (
        <a
            href={href}
            class="inline-flex items-center gap-1.5 px-2 py-1 -ml-2 rounded-md text-[13px] font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            aria-label={`Back to ${label}`}
        >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path>
            </svg>
            <span>{label}</span>
        </a>
    );
};
