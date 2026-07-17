import { useCallback, useEffect, useState } from "react";
import { m } from "~/paraglide/messages";

/**
 * Shared graceful-degradation logic for every "download/preview PDF" surface
 * that triggers a live Cloudflare Browser Rendering render on click
 * (report PDF, editor preview, verify page, repair-request share).
 *
 * Why this exists: the server render can be rate-limited. On the Workers **Free**
 * plan Browser Rendering allows only 1 render every 10 seconds
 * (https://developers.cloudflare.com/browser-run/limits/). A back-to-back second
 * render is absorbed server-side (generatePdfWithTocPages degrades to the
 * un-numbered PDF), but a hard failure — daily browser-hours exhausted, or the
 * first render itself rate-limited — still returns a non-ok response. Plain
 * `<a href>` / `window.open` surfaces then navigate to a raw JSON 500 and let the
 * user click again immediately, compounding the limit. This hook fetches the PDF,
 * catches the failure, and counts down a cooldown so every surface reminds the
 * user to wait instead of hammering the renderer. Copy is centralized here so the
 * reminder reads identically everywhere.
 */

// Free-tier Browser Rendering allows 1 render / 10s; 20s clears the window with
// margin so a retry after the countdown reliably succeeds.
const PDF_RETRY_COOLDOWN_SEC = 20;

// A function (not a const) so the message resolves at call time in the active
// locale, never frozen at module import.
export function pdfBusyHint(): string {
  return m.helper_pdf_busy_hint();
}

export interface PdfExportState {
  /** A render request is in flight. */
  generating: boolean;
  /** Seconds remaining before a retry is allowed (0 when not cooling down). */
  cooldown: number;
  /** User-facing failure reason, or null. */
  error: string | null;
  /** generating || cooldown > 0 — disable the trigger while true. */
  busy: boolean;
  /** Kick off a render+download (or new-tab preview when mode === "view"). */
  exportPdf: (url: string, opts?: { filename?: string; mode?: "download" | "view" }) => Promise<void>;
}

/**
 * The action label a trigger should show: "Retry in Ns" while cooling down,
 * "Generating…" while rendering, otherwise the surface's own default label.
 */
export function pdfActionLabel(state: Pick<PdfExportState, "generating" | "cooldown">, defaultLabel: string): string {
  if (state.cooldown > 0) return m.helper_pdf_retry_in({ seconds: state.cooldown });
  if (state.generating) return m.helper_pdf_generating();
  return defaultLabel;
}

export function usePdfExport(): PdfExportState {
  const [generating, setGenerating] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Tick the retry cooldown down to zero — one timer per second.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const exportPdf = useCallback(
    async (url: string, opts?: { filename?: string; mode?: "download" | "view" }) => {
      if (generating || cooldown > 0) return;
      const mode = opts?.mode ?? "download";
      // Open the preview tab synchronously inside the click gesture so the async
      // fetch that follows doesn't trip the popup blocker. about:blank keeps a
      // handle (noopener would null it); the tab only ever loads a same-origin
      // blob, so there is no reverse-tabnabbing surface.
      const viewTab = mode === "view" ? window.open("about:blank", "_blank") : null;
      setGenerating(true);
      setError(null);
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok) {
          viewTab?.close();
          setCooldown(PDF_RETRY_COOLDOWN_SEC);
          setError(m.helper_pdf_rate_limit());
          return;
        }
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        if (mode === "view" && viewTab) {
          viewTab.location.href = objUrl;
          // Revoke after the tab has had time to load the blob.
          setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
        } else {
          const a = document.createElement("a");
          a.href = objUrl;
          a.download = opts?.filename ?? "report.pdf";
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(objUrl);
        }
      } catch (err) {
        console.error(err);
        viewTab?.close();
        setCooldown(PDF_RETRY_COOLDOWN_SEC);
        setError(m.helper_pdf_network());
      } finally {
        setGenerating(false);
      }
    },
    [generating, cooldown],
  );

  return { generating, cooldown, error, busy: generating || cooldown > 0, exportPdf };
}
