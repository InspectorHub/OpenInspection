import { useRef, useState } from "react";
import { PENDING_CLASS, pendingProps, useActionLatch, useLayer } from "@core/shared-ui";
import { useFieldDataSource } from "../../context";
import type { VideoFinalizeInput } from "../../data-source-types";
import { m } from "../../i18n";

/**
 * Plan 7 — video walk-through capture (pluggable backend: Stream or R2).
 *
 * Flow (both providers), through the data source's `resources.video`: pick/capture
 * a clip → validate type + size BEFORE upload → `createUpload` answers
 * { uploadURL, provider, ref } → `uploadFile` sends the clip to the returned URL
 * (with progress) → provider-specific post-processing → `finalize` with the final
 * ref (+ optional posterKey for R2).
 *
 * R2 path:
 *   1. Shows a privacy notice with an explicit acceptance checkbox before the
 *      pick button (location data is NOT stripped from R2-stored files).
 *   2. `uploadFile` answers { mediaId, r2Key } as the REAL ref (the placeholder
 *      r2Key from createUpload uses .mp4 regardless of MIME).
 *   3. Grabs the first frame via canvas → `uploadPoster`.
 *   4. Finalizes with { provider:'r2', mediaId, r2Key, posterKey? }.
 *
 * Stream path:
 *   The file goes straight to Cloudflare (bytes bypass the worker → no
 *   GPS-leak path). Finalizes with { provider:'stream', streamUid }.
 *
 * Offline: video does NOT use the offline photo queue (clip sizes make
 * IndexedDB replay impractical). When offline the add tile is disabled.
 */

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_VIDEO_SEC = 30;
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

export interface VideoCaptureProps {
  inspectionId: string;
  /** The active video backend for this tenant. */
  provider: "stream" | "r2";
  /** Optional placement intent forwarded to create-upload. */
  itemId?: string;
  onClose: () => void;
  /**
   * Called after finalize succeeds. Receives the finalize result so the host
   * can refetch the pool row or refresh state.
   */
  onUploaded: (result: { poolId: string; provider: "stream" | "r2" }) => void;
}

type Phase = "pick" | "uploading" | "finalizing";

/** Pure validation (type + size). Duration is enforced server-side by Stream. */
export function validateVideoFile(file: File): string | null {
  if (!(ALLOWED_VIDEO_TYPES as readonly string[]).includes(file.type)) {
    return m.media_video_err_format();
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return m.media_video_err_too_large();
  }
  return null;
}

export function VideoCapture({ inspectionId, provider, itemId, onClose, onUploaded }: VideoCaptureProps) {
  const video = useFieldDataSource().resources.video;
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  // R2 privacy notice: upload is blocked until the user explicitly accepts.
  const [accepted, setAccepted] = useState(false);
  const busy = phase !== "pick";
  // Same-frame guard: each upload mints a pool row and an R2/Stream object, and `busy` only lands after a render.
  const uploadLatch = useActionLatch(busy);

  const handleFile = async (file: File) => {
    setError(null);
    // Validate type + size client-side (eager-after-error inline message).
    const ve = validateVideoFile(file);
    if (ve) {
      setError(ve);
      return;
    }

    // Busy from the first request on, so a later pick cannot start a second upload while create-upload is in flight.
    setPhase("uploading");
    setProgress(0);
    const fail = (message: string | undefined, fallback: string) => {
      setPhase("pick");
      setError(message || fallback);
    };
    try {
      // A host without the video flow cannot upload; say so rather than doing nothing.
      if (!video) return fail(undefined, m.media_video_err_upload());

      // Step 1: mint an upload URL + a backend ref.
      const created = await video.createUpload(inspectionId, itemId ? { itemId } : {});
      if (!created.ok || !created.data) return fail(created.error, m.media_video_err_unexpected());
      const ticket = created.data;

      // Step 2: upload the file to the returned URL.
      setPhase("uploading");
      setProgress(0);
      const uploaded = await video.uploadFile(ticket, file, setProgress);
      if (!uploaded.ok) return fail(uploaded.error, m.media_video_err_upload());

      let finalRef: VideoFinalizeInput;
      if (ticket.ref.provider === "r2") {
        // R2: the upload answers the REAL { mediaId, r2Key }.
        const real = uploaded.data;
        if (!real?.mediaId || !real?.r2Key) return fail(undefined, m.media_video_err_unexpected());

        // Step 3: grab the first frame and store it as the poster JPEG. A poster failure is non-fatal:
        // finalize without one.
        let posterKey: string | undefined;
        try {
          const posterBlob = await grabFirstFrame(file);
          if (posterBlob) {
            const poster = await video.uploadPoster(inspectionId, ticket, posterBlob);
            if (poster.ok) posterKey = poster.data?.posterKey;
          }
        } catch {
          // Non-fatal: poster grab failed (canvas blocked, browser quirk, etc.)
        }
        finalRef = posterKey
          ? { provider: "r2", mediaId: real.mediaId, r2Key: real.r2Key, posterKey }
          : { provider: "r2", mediaId: real.mediaId, r2Key: real.r2Key };
      } else {
        finalRef = ticket.ref;
      }

      // Step 4: finalize → pool row appears in the strip.
      setPhase("finalizing");
      const finalized = await video.finalize(inspectionId, finalRef);
      if (!finalized.ok) return fail(finalized.error, m.media_video_err_upload());
      onUploaded({ poolId: finalized.data?.poolId ?? "", provider: finalRef.provider });
      onClose();
    } catch {
      fail(undefined, m.media_video_err_upload());
    }
  };

  // The pick button is disabled while busy OR (R2 only) until the privacy
  // notice has been accepted.
  const pickDisabled = busy || (provider === "r2" && !accepted);

  // Full-screen sheet: takes Escape; an upload in flight keeps it open, like its backdrop.
  useLayer(true, { onEscape: () => { if (!busy) onClose(); }, lockScroll: true });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={m.media_video_add_aria()}>
      <button type="button" aria-label={m.common_close()} className="absolute inset-0 bg-ih-backdrop" onClick={busy ? undefined : onClose} />
      <div data-testid="video-capture" className="relative w-full max-w-md rounded-t-2xl bg-ih-bg-card p-4 shadow-ih-popover">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ih-fg-1">{m.media_video_add_heading()}</h2>
          <button
            type="button"
            {...pendingProps(busy, onClose)}
            className={`min-h-[44px] min-w-[44px] rounded-lg px-3 text-[13px] font-bold text-ih-fg-3 hover:text-ih-fg-1 ${PENDING_CLASS}`}
          >
            {m.common_cancel()}
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.currentTarget.value = "";
            // `busy` covers a pick that arrives after the latch released but while an upload is still out.
            if (f) uploadLatch(() => { if (!busy) void handleFile(f); });
          }}
        />

        {error && (
          <p data-testid="video-error" role="alert" className="mb-3 rounded-lg bg-ih-bad-bg px-3 py-2 text-[12px] font-semibold text-ih-bad-fg">
            {error}
          </p>
        )}

        {/* R2 privacy notice — must be accepted before upload is enabled. Absent on Stream. */}
        {provider === "r2" && phase === "pick" && (
          <label data-testid="r2-privacy-notice" className="mb-3 flex items-start gap-2 text-[13px] text-ih-fg-2">
            <input
              type="checkbox"
              data-testid="r2-privacy-checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 accent-ih-primary"
            />
            <span>
              {m.media_video_privacy_before()}{" "}
              <strong>{m.media_video_privacy_not()}</strong> {m.media_video_privacy_after()}
            </span>
          </label>
        )}

        {phase === "uploading" || phase === "finalizing" ? (
          <div className="py-2">
            <div className="mb-1 flex items-center justify-between text-[12px] font-semibold text-ih-fg-2">
              <span>{phase === "finalizing" ? m.media_video_processing() : m.media_video_uploading()}</span>
              <span className="tabular-nums">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-ih-bg-muted">
              <div
                data-testid="video-progress"
                className="h-full rounded-full bg-ih-primary transition-[width]"
                style={{ width: `${phase === "finalizing" ? 100 : progress}%` }}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-testid="pick-button"
            disabled={pickDisabled}
            onClick={() => inputRef.current?.click()}
            className="min-h-[44px] w-full rounded-xl bg-ih-primary px-5 text-[14px] font-bold text-ih-fg-inverse hover:bg-ih-primary-600 disabled:opacity-50"
          >
            {m.media_video_pick()}
          </button>
        )}

        <p className="mt-3 text-[11px] text-ih-fg-3">{m.media_video_formats_hint({ maxSec: MAX_VIDEO_SEC })}</p>
      </div>
    </div>
  );
}

/**
 * Grab the first frame of a video file as a JPEG Blob.
 *
 * Loads the file into a hidden <video>, seeks to t=0, draws to an
 * offscreen <canvas>, and resolves with the canvas JPEG output.
 * Returns null when the browser can't decode the clip (e.g. codec not
 * supported) — the caller treats a null poster as non-fatal.
 */
export function grabFirstFrame(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => URL.revokeObjectURL(objectUrl);

    // Timeout safety net — if the browser stalls, resolve null rather than hang.
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);

    video.onloadeddata = () => {
      clearTimeout(timer);
      video.currentTime = 0;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            resolve(blob);
          },
          "image/jpeg",
          0.85,
        );
      } catch {
        cleanup();
        resolve(null);
      }
    };

    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      resolve(null);
    };

    // Defense-in-depth for the media `.src` URL sink (CWE-79): URL-encode the
    // object URL before assigning it. encodeURI is a no-op on the well-formed
    // same-origin `blob:` URL that createObjectURL always returns, but it
    // neutralizes any metacharacters in a value that might reach this sink after
    // a future refactor — standard practice for a dynamically-derived `.src`.
    video.src = encodeURI(objectUrl);
    video.load();
  });
}
