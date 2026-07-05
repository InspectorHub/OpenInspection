import type { ReactNode } from "react";

interface AuthShellProps {
  heading: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Shared chrome for the unauthenticated auth pages (login, join, forgot, reset).
 * Layout only — no form logic, no data dependencies — so it's trivial to reason
 * about and every auth page looks identical. Full-screen centered card with the
 * product logo, a heading, an optional subtitle, the page body, and an optional
 * footer (e.g. a "Back to log in" link).
 */
export function AuthShell({ heading, subtitle, footer, children }: AuthShellProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
      <div className="w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.svg" alt="" className="w-8 h-8" width={32} height={32} />
          <span className="text-lg font-bold text-ih-fg-1">OpenInspection</span>
        </div>

        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">{heading}</h1>
        {subtitle ? <p className="text-sm text-ih-fg-3 mb-6">{subtitle}</p> : null}

        {children}

        {footer ? <div className="mt-6 text-sm text-ih-fg-3">{footer}</div> : null}
      </div>
    </div>
  );
}
