import type { BreadcrumbItem } from "./Breadcrumb";

interface BackButtonProps {
  items?: BreadcrumbItem[];
  fallbackHref?: string;
}

export function BackButton({ items, fallbackHref }: BackButtonProps) {
  const target = items && items.length >= 2 ? items[items.length - 2] : null;
  const href = target?.href ?? fallbackHref ?? "/dashboard";
  const label = target?.label ?? "Back";
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 px-2 py-1 -ml-2 rounded-md text-[13px] font-medium text-ih-fg-3 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:shadow-ih-focus"
      aria-label={`Back to ${label}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
      </svg>
      <span>{label}</span>
    </a>
  );
}
