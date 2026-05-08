/**
 * Breadcrumb — chevron-separated trail of links.
 *
 * Last item is the current page (bold non-link with aria-current).
 * Earlier items are slate-500 anchor tags with hover-darken.
 *
 * Sub-component of PageHeader (Sub-spec B Task 1) — exported separately so
 * detail pages with custom layouts can mount it without the rest of PageHeader.
 */

export interface BreadcrumbItem {
    label: string;
    href?: string;
}

export const Breadcrumb = ({ items }: { items: BreadcrumbItem[] }): JSX.Element => {
    if (!items || items.length === 0) return <></>;
    return (
        <nav aria-label="Breadcrumb" class="flex items-center gap-1.5 text-[12px] font-medium">
            {items.map((it, i) => {
                const isLast = i === items.length - 1;
                return (
                    <>
                        {i > 0 && <span class="text-slate-300 select-none" aria-hidden="true">{'›'}</span>}
                        {isLast ? (
                            <span class="text-slate-900 font-bold" aria-current="page">{it.label}</span>
                        ) : (
                            <a href={it.href || '#'} class="text-slate-500 hover:text-slate-900 transition-colors">{it.label}</a>
                        )}
                    </>
                );
            })}
        </nav>
    );
};
