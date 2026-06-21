/**
 * Plan 7 — video walk-through player (pluggable backend: Stream or R2).
 *
 * Provider branch:
 *   'stream' — renders the Cloudflare Stream <iframe> (needs streamCustomerSubdomain).
 *              Transcoding progress shown while readyToStream === false.
 *   'r2'     — renders a native <video> element served by the worker's
 *              r2-object route, with an optional poster frame.
 *
 * Fail closed: for Stream, when the subdomain is absent we render a
 * "Video unavailable" panel rather than a fabricated/broken subdomain.
 */

export interface VideoPlayerProps {
  provider: "stream" | "r2";
  // ── Stream fields ──────────────────────────────────────────────────────────
  /** Cloudflare Stream UID. Required when provider='stream'. */
  streamUid?: string;
  /** Cloudflare Stream customer subdomain. Null/empty ⇒ unavailable (fail closed). */
  streamCustomerSubdomain?: string | null;
  /** False while Stream is still transcoding the upload. */
  readyToStream?: boolean;
  /** 0..100 transcode progress, when known. */
  pctComplete?: number;
  // ── R2 fields ─────────────────────────────────────────────────────────────
  /** Inspection id — used to build the r2-object URL. Required when provider='r2'. */
  inspectionId?: string;
  /** Pool row id (= mediaId). Required when provider='r2'. */
  mediaId?: string;
}

export function streamIframeSrc(subdomain: string, streamUid: string): string {
  return `https://${subdomain}.cloudflarestream.com/${streamUid}/iframe`;
}

export function VideoPlayer({
  provider,
  streamUid,
  streamCustomerSubdomain,
  readyToStream = true,
  pctComplete,
  inspectionId,
  mediaId,
}: VideoPlayerProps) {
  // ── R2 branch ──────────────────────────────────────────────────────────────
  if (provider === "r2") {
    if (!inspectionId || !mediaId) {
      return (
        <div
          data-testid="video-unavailable"
          className="flex aspect-video w-full items-center justify-center rounded-xl bg-ih-bg-muted text-[13px] text-ih-fg-3"
        >
          Video unavailable
        </div>
      );
    }

    const objectURL = `/api/inspections/${inspectionId}/media/video/r2-object/${mediaId}`;
    const posterURL = `${objectURL}/poster`;

    return (
      <div data-testid="video-player-r2" className="relative aspect-video w-full overflow-hidden rounded-xl bg-ih-bg-muted">
        <video
          controls
          poster={posterURL}
          src={objectURL}
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }

  // ── Stream branch ──────────────────────────────────────────────────────────
  if (!streamCustomerSubdomain || !streamUid) {
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
