import type { ReactNode } from "react";
import type { useFetcher } from "react-router";

/**
 * Shared "Test connection" control used by the Resend / Stripe / Gemini
 * integration panels. Renders a fetcher Form that posts a hidden `intent`, a
 * submit button that disables + relabels while the probe is in flight, and
 * whatever result UI the caller passes as `children` (the result shape differs
 * per integration, so it stays per-use).
 *
 * The form/button markup is identical across the panels; only the fetcher,
 * intent string, and result display vary.
 */
export function TestConnectionButton({
  fetcher,
  intent,
  idleLabel = "Test connection",
  busyLabel = "Testing…",
  children,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  intent: string;
  idleLabel?: string;
  busyLabel?: string;
  /** Per-integration result display rendered next to the button. */
  children?: ReactNode;
}) {
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="intent" value={intent} />
      <button
        type="submit"
        disabled={busy}
        className="h-8 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60"
      >
        {busy ? busyLabel : idleLabel}
      </button>
      {children}
    </fetcher.Form>
  );
}
