import { useState } from "react";
import { useFetcher } from "react-router";
import { formatInspectionDateTime } from "~/lib/format-date";
import { useInspectionDateTimeFormat } from "~/hooks/useSessionContext";
import type { InspectionDateTimeFormat } from "~/lib/format-date";
import { m } from "~/paraglide/messages";

// IA-64 — the read side of change traceability. Templates and comments are
// company assets whose edits were already audited but never surfaced. This
// disclosure lazy-loads an entity's audit trail on first open (no N+1 on the
// parent list) and shows "Last edited by X" plus the full history.
export interface AuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: number;
}

function actionLabel(action: string): string {
  if (action.endsWith(".create") || action.endsWith(".created")) return m.audit_action_created();
  if (action.endsWith(".update") || action.endsWith(".updated")) return m.audit_action_updated();
  if (action.endsWith(".delete") || action.endsWith(".deleted")) return m.audit_action_deleted();
  return m.audit_action_other();
}

function when(createdAt: number, timeZone: string, fmt: InspectionDateTimeFormat): string {
  return formatInspectionDateTime(new Date(createdAt).toISOString(), undefined, timeZone, fmt);
}

export function EntityAuditTrail({ entityId, timeZone }: { entityId: string; timeZone: string }) {
  const fmt = useInspectionDateTimeFormat();
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<{ entries: AuditEntry[] }>();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(`/resources/entity-audit?entityId=${encodeURIComponent(entityId)}`);
    }
  }

  const entries = fetcher.data?.entries ?? [];
  const latest = entries[0];

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-ih-fg-3 hover:text-ih-fg-2 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {open ? m.audit_trail_hide() : m.audit_trail_history()}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-ih-border bg-ih-bg-app/40 px-3 py-2">
          {fetcher.state === "loading" ? (
            <p className="text-[11px] text-ih-fg-3">{m.audit_trail_loading()}</p>
          ) : entries.length === 0 ? (
            <p className="text-[11px] text-ih-fg-3">{m.audit_trail_empty()}</p>
          ) : (
            <>
              <p className="text-[11px] font-semibold text-ih-fg-2">
                {m.audit_trail_last_edited({ name: latest.actorName || m.audit_trail_unknown_actor() })}
                <span className="text-ih-fg-4 font-normal"> · {when(latest.createdAt, timeZone, fmt)}</span>
              </p>
              <ul className="mt-1.5 space-y-1 border-t border-ih-border pt-1.5">
                {entries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 text-[11px] text-ih-fg-3">
                    <span>
                      <span className="font-medium text-ih-fg-2">{actionLabel(e.action)}</span> · {e.actorName || m.audit_trail_unknown_actor()}
                    </span>
                    <span className="text-ih-fg-4 shrink-0">{when(e.createdAt, timeZone, fmt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
