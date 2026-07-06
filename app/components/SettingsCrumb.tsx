export interface CrumbItem {
  label: string;
  href?: string;
}

interface SettingsCrumbProps {
  items: CrumbItem[];
}

/**
 * Settings subpage header: a compact breadcrumb trail for wayfinding plus a
 * prominent page title. The last item is the current page — it renders as the
 * final (non-linked) crumb AND as the page title below the trail, so callers
 * pass a single `items` array and get both the breadcrumb and the heading.
 * The layout already shows a persistent "Settings" section header above this.
 */
export function SettingsCrumb({ items }: SettingsCrumbProps) {
  const title = items[items.length - 1]?.label ?? "";
  return (
    <div>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-semibold text-ih-fg-3 flex-wrap">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              {idx > 0 && (
                <svg className="w-3 h-3 text-ih-fg-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
              {item.href && !isLast ? (
                <a href={item.href} className="hover:text-ih-primary transition-colors">{item.label}</a>
              ) : (
                <span className="text-ih-fg-3">{item.label}</span>
              )}
            </span>
          );
        })}
      </nav>
      <h2 className="mt-1 text-lg font-bold text-ih-fg-1">{title}</h2>
    </div>
  );
}
