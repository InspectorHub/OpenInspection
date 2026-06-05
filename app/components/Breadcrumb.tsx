export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  if (!items || items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px] font-medium">
      {items.map((it, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={it.label} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-ih-fg-4 select-none" aria-hidden="true">&rsaquo;</span>}
            {isLast ? (
              <span className="text-ih-fg-1 font-bold" aria-current="page">{it.label}</span>
            ) : (
              <a href={it.href ?? "#"} className="text-ih-fg-3 hover:text-ih-fg-1 transition-colors">{it.label}</a>
            )}
          </span>
        );
      })}
    </nav>
  );
}
