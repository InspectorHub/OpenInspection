/**
 * Shared "last tested" status line for every Settings "Test connection" button.
 *
 * Pairs with <TestConnectionButton>: the button runs the probe, this component
 * renders the PERSISTED outcome (time + ✓/✗ + reason) so the panel still shows
 * the last result after a reload, plus a collapsible recent history. All four
 * integrations (SMS / email / Stripe / Gemini) reuse this — no per-panel copy.
 *
 * Fed straight from the route loader's `integrations/test-results` array; the
 * component filters to its own `target` so callers pass the same list everywhere.
 */
import { useMemo } from "react";
import type { ConnectionTestResult } from "~/lib/connection-test";
import { m } from "~/paraglide/messages";

export type { ConnectionTestResult };

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago", else a date. */
function relativeTime(epochMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - epochMs);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return m.settings_conn_time_just_now();
  if (min < 60) return m.settings_conn_time_minutes({ min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return m.settings_conn_time_hours({ hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return m.settings_conn_time_days({ day });
  return new Date(epochMs).toLocaleDateString();
}

function absoluteTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

export function ConnectionTestStatus({
  results,
  target,
  nowMs,
}: {
  /** Full loader list; the component filters to `target` itself. */
  results: ConnectionTestResult[];
  target: ConnectionTestResult["target"];
  /** Injectable clock for deterministic tests; defaults to Date.now(). */
  nowMs?: number;
}) {
  const now = nowMs ?? Date.now();
  const mine = useMemo(
    () =>
      results
        .filter((r) => r.target === target)
        .sort((a, b) => b.testedAt - a.testedAt),
    [results, target],
  );

  if (mine.length === 0) {
    return (
      <span className="text-[11px] text-ih-fg-4" aria-live="polite">
        {m.settings_conn_status_not_tested()}
      </span>
    );
  }

  const latest = mine[0];
  const history = mine.slice(1);

  return (
    <div className="flex flex-col gap-1 text-[11px]" aria-live="polite">
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${latest.ok ? "bg-ih-ok-fg" : "bg-ih-bad-fg"}`}
          aria-hidden
        />
        <span className={`font-bold ${latest.ok ? "text-ih-ok-fg" : "text-ih-bad-fg"}`}>
          {latest.ok ? m.settings_conn_status_connected() : m.settings_conn_status_failed()}
        </span>
        <span className="text-ih-fg-3">
          {m.settings_conn_last_tested()}{" "}
          <time dateTime={new Date(latest.testedAt).toISOString()} title={absoluteTime(latest.testedAt)}>
            {relativeTime(latest.testedAt, now)}
          </time>
          {latest.provider ? ` · ${latest.provider}` : ""}
        </span>
      </span>

      {latest.detail ? (
        <span className={latest.ok ? "text-ih-fg-3" : "text-ih-bad-fg"}>{latest.detail}</span>
      ) : null}

      {history.length > 0 ? (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-ih-fg-4 hover:text-ih-fg-2 select-none">
            {m.settings_conn_recent_tests({ count: history.length })}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-3">
            {history.map((r) => (
              <li key={r.testedAt} className="flex items-baseline gap-1.5">
                <span className={`font-bold ${r.ok ? "text-ih-ok-fg" : "text-ih-bad-fg"}`}>
                  {r.ok ? "✓" : "✗"}
                </span>
                <span className="text-ih-fg-3">
                  <time dateTime={new Date(r.testedAt).toISOString()} title={absoluteTime(r.testedAt)}>
                    {relativeTime(r.testedAt, now)}
                  </time>
                  {r.detail ? ` — ${r.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
