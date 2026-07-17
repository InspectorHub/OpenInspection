/**
 * Commercial PCA Phase W Task 6 — "Export to Word" owner control.
 *
 * One-way export: enqueue -> poll -> download. There is no "edit in place"
 * affordance — the `.docx` is terminal delivery (see the Phase W plan's
 * Global Constraints). Mounted ONLY in the authed owner-preview context
 * (see `<ReportView>`'s `data.ownerPreview` gate) — the public token viewer
 * has no JWT session and never sees this control.
 *
 * BFF relay only (feedback_core_bff_no_client_fetch): the enqueue POST and
 * the status poll GET both ride `useFetcher` -> the host route's `action`
 * (mirrors the Commercial PCA Phase M Task 10 CompliancePanel pattern:
 * `app/routes/inspection-edit/action.server.ts`'s `compliance-*` intents).
 * The component owns its own fetcher instance — never share it with an
 * unrelated in-flight mutation on the same page (feedback_rr_shared_fetcher_abort).
 *
 * The download step is a plain same-origin `<a href>` GET: the owner's
 * session is carried via the `__Host-inspector_token` cookie fallback that
 * `jwtAuthMiddleware` already accepts for every authenticated `/api/*` route
 * (server/index.ts) — the same mechanism the sibling "Download PDF" FAB in
 * this file already relies on for its raw fetch. GET carries no CSRF risk
 * (CSRF protection only gates state-changing methods), so no proxy route is
 * needed for the download step; only the enqueue (POST) and status poll
 * strictly require the BFF relay.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { m } from "~/paraglide/messages";

export type WordExportStatus = "queued" | "building" | "ready" | "failed";

interface EnqueueResult {
  ok: boolean;
  intent: "export-word-enqueue";
  exportId?: string;
  code?: string;
  error?: string | null;
}

interface StatusResult {
  ok: boolean;
  intent: "export-word-status";
  status?: WordExportStatus;
  error?: string | null;
}

type ExportActionResult = EnqueueResult | StatusResult;

export interface WordExportButtonProps {
  /** Inspection id — used to build the enqueue/status/download URLs. */
  inspectionId: string;
  /**
   * Structural gate resolved by the mount site: commercial-tier report AND
   * owner-preview session. `false` renders nothing (not even a disabled
   * affordance) — this is distinct from the dynamic `EXPORT_UNAVAILABLE`
   * 503 gate below, which renders a disabled control with a tooltip instead
   * of hiding entirely (the queue binding being absent is a deployment fact
   * worth surfacing, not a reason to pretend the feature doesn't exist).
   */
  available?: boolean;
  /** Poll interval while status is queued/building. Overridable for tests. */
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 4000;

const PILL_BASE =
  "print:hidden px-5 py-3 rounded-full text-xs font-bold uppercase tracking-widest shadow-ih-popover transition-all flex items-center gap-2";

export function WordExportButton({
  inspectionId,
  available = true,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: WordExportButtonProps) {
  const fetcher = useFetcher<ExportActionResult>();
  const [exportId, setExportId] = useState<string | null>(null);
  const [status, setStatus] = useState<WordExportStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lastHandled = useRef<ExportActionResult | undefined>(undefined);

  // Consume fetcher results (enqueue OR status-poll response) exactly once
  // per response — `fetcher.data` keeps the same reference across renders,
  // so without the guard this effect would re-fire and re-apply stale data.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data === lastHandled.current) return;
    lastHandled.current = fetcher.data;
    const data = fetcher.data;

    if (data.intent === "export-word-enqueue") {
      if (!data.ok) {
        if (data.code === "EXPORT_UNAVAILABLE") {
          setUnavailable(true);
        } else {
          setErrorMessage(data.error ?? m.pca_word_export_error_start());
          setStatus("failed");
        }
        return;
      }
      setExportId(data.exportId ?? null);
      setStatus("queued");
      return;
    }

    if (data.intent === "export-word-status") {
      if (!data.ok) {
        setErrorMessage(data.error ?? m.pca_word_export_error_status());
        setStatus("failed");
        return;
      }
      setStatus(data.status ?? null);
      if (data.status === "failed") {
        setErrorMessage(data.error ?? m.pca_word_export_error_failed());
      }
    }
  }, [fetcher.state, fetcher.data]);

  // Poll on an interval while queued/building; stop on ready/failed.
  useEffect(() => {
    if (!exportId || (status !== "queued" && status !== "building")) return;
    const timer = setInterval(() => {
      if (fetcher.state !== "idle") return;
      fetcher.submit({ intent: "export-word-status", exportId }, { method: "POST" });
    }, pollIntervalMs);
    return () => clearInterval(timer);
    // `fetcher` intentionally omitted — its identity is stable per the RR
    // contract, and including it would restart the interval every render.
  }, [exportId, status, pollIntervalMs]);

  if (!available) return null;

  const enqueue = () => {
    setErrorMessage(null);
    fetcher.submit({ intent: "export-word-enqueue" }, { method: "POST" });
  };

  if (unavailable) {
    return (
      <span
        className={`${PILL_BASE} bg-ih-bg-muted text-ih-fg-4 cursor-not-allowed opacity-70`}
        title={m.pca_word_export_unavailable_title()}
        data-testid="word-export-unavailable"
      >
        {m.pca_word_export_label()}
      </span>
    );
  }

  if (status === "ready" && exportId) {
    return (
      <a
        href={`/api/inspections/${inspectionId}/export/${exportId}/download`}
        download
        className={`${PILL_BASE} bg-ih-primary text-ih-primary-fg hover:opacity-90`}
        data-testid="word-export-download-link"
      >
        {m.pca_word_export_download()}
      </a>
    );
  }

  if (status === "failed") {
    return (
      <button
        type="button"
        onClick={enqueue}
        className={`${PILL_BASE} bg-ih-bg-card border border-ih-bad-fg text-ih-bad-fg hover:bg-ih-bg-muted`}
        title={errorMessage ?? undefined}
        data-testid="word-export-retry"
      >
        {m.pca_word_export_retry()}
      </button>
    );
  }

  const busy = status === "queued" || status === "building" || fetcher.state !== "idle";

  return (
    <button
      type="button"
      onClick={enqueue}
      disabled={busy}
      className={`${PILL_BASE} bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted disabled:opacity-60 disabled:cursor-not-allowed`}
      data-testid="word-export-button"
    >
      {busy ? m.pca_word_export_preparing() : m.pca_word_export_label()}
    </button>
  );
}

export default WordExportButton;
