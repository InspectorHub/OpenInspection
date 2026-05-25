export interface CrumbItem {
    label: string;
    href?: string;
}

/**
 * Lightweight breadcrumb used at the top of every settings sub-page.
 * Paper-themed: surface-* backgrounds, ink-* text, blueprint accent.
 *
 * Usage:
 *   <SettingsCrumb items={[
 *       { label: 'Settings', href: '/settings' },
 *       { label: 'Workspace', href: '/settings/workspace' },
 *       { label: 'Branding' },
 *   ]} />
 */
export const SettingsCrumb = ({ items }: { items: CrumbItem[] }): JSX.Element => (
    <nav aria-label="Breadcrumb" class="flex items-center gap-1.5 text-xs font-semibold text-ink-500 flex-wrap">
        {items.map((item, idx) => {
            const isLast = idx === items.length - 1;
            return (
                <>
                    {idx > 0 && (
                        <svg class="w-3 h-3 text-ink-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                    )}
                    {item.href && !isLast ? (
                        <a href={item.href} class="hover:text-blueprint-700 transition-colors">{item.label}</a>
                    ) : (
                        <span class={isLast ? 'text-ink-900 font-bold' : 'text-ink-500'}>{item.label}</span>
                    )}
                </>
            );
        })}
    </nav>
);
