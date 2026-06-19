/**
 * Plan 7 — Cloudflare Stream player for the unified media viewer.
 *
 * Renders the Stream `<iframe>` at a fixed 16/9 aspect (no CLS), lazy-loaded.
 * Until the upload finishes transcoding (`readyToStream === false`) it shows a
 * "Processing…" state instead of the iframe.
 *
 * The iframe URL needs the account's Stream customer subdomain (from
 * `env.STREAM_CUSTOMER_SUBDOMAIN`, threaded through loader data). When the
 * subdomain is absent we fail closed — no fabricated subdomain — and render a
 * "Video unavailable" panel.
 */

export interface VideoPlayerProps {
  streamUid: string;
  /** Cloudflare Stream customer subdomain. Null/empty ⇒ unavailable (fail closed). */
  streamCustomerSubdomain: string | null;
  /** False while Stream is still transcoding the upload. */
  readyToStream?: boolean;
  /** 0..100 transcode progress, when known. */
  pctComplete?: number;
}

export function streamIframeSrc(subdomain: string, streamUid: string): string {
  return `https://${subdomain}.cloudflarestream.com/${streamUid}/iframe`;
}

export function VideoPlayer({
  streamUid,
  streamCustomerSubdomain,
  readyToStream = true,
  pctComplete,
}: VideoPlayerProps) {
  if (!streamCustomerSubdomain) {
    return (
      <div
        data-testid="video-unavailable"
        className="flex aspect-video w-full items-center justify-center rounded-xl bg-ih-bg-muted text-[13px] text-ih-fg-3"
      >
        Video unavailable
      </div>
    );
  }

  if (!readyToStream) {
    return (
      <div
        data-testid="video-processing"
        className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-ih-bg-muted text-[13px] text-ih-fg-3"
      >
        <svg className="h-6 w-6 animate-spin text-ih-primary" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <span>Processing…{typeof pctComplete === "number" ? ` ${Math.round(pctComplete)}%` : ""}</span>
      </div>
    );
  }

  return (
    <div data-testid="video-player" className="relative aspect-video w-full overflow-hidden rounded-xl bg-ih-bg-muted">
      <iframe
        src={streamIframeSrc(streamCustomerSubdomain, streamUid)}
        title="Video walk-through"
        loading="lazy"
        allow="accelerated-2d-canvas; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}
