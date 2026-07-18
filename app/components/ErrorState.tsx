/**
 * Shared, design-system-consistent error / not-found surface.
 *
 * Used by the root ErrorBoundary (app/root.tsx) and the public report pages
 * (report-card-stack, report-gate) so every error/not-found screen looks the
 * same — branded card, icon, title, optional code + message + CTA — instead of
 * the previous bare "Something went wrong" text and three divergent styles.
 *
 * Brand-neutral by default (works for both authed app surfaces and public,
 * no-login report links). Pass `action` only where there is a sensible place to
 * send the user; public report errors omit it.
 */
interface ErrorStateAction {
  label: string;
  href: string;
}

export interface ErrorStateProps {
  /** Optional HTTP-ish code shown as an eyebrow (e.g. 404, 500). */
  code?: string | number;
  /** Short headline, e.g. "Report not found". */
  title: string;
  /** Friendly explanation. */
  message?: string;
  /** Optional primary CTA. Rendered as a plain anchor so it works even when the
   *  router context is unavailable (e.g. inside the root error boundary). */
  action?: ErrorStateAction;
}

export function ErrorState({ code, title, message, action }: ErrorStateProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-app px-6 py-12">
      <div className="w-full max-w-md text-center bg-ih-bg-card border border-ih-border rounded-2xl shadow-ih-card p-10">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-ih-bg-muted">
          <svg
            className="h-7 w-7 text-ih-fg-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        {code != null && (
          <p className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-4 mb-1">
            Error {code}
          </p>
        )}
        <h1 className="font-serif text-[24px] font-semibold tracking-tight text-ih-fg-1">
          {title}
        </h1>
        {message && (
          <p className="mt-2 text-[14px] leading-relaxed text-ih-fg-3">{message}</p>
        )}
        {action && (
          <a
            href={action.href}
            className="mt-6 inline-flex items-center justify-center h-11 px-6 rounded-lg text-sm font-bold text-ih-fg-inverse bg-ih-primary hover:bg-ih-primary-600 transition-colors"
          >
            {action.label}
          </a>
        )}
      </div>
    </div>
  );
}
