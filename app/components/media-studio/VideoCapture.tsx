import { useRef, useState } from "react";

/**
 * Plan 7 — video walk-through capture (pluggable backend: Stream or R2).
 *
 * Flow (both providers): pick/capture a clip → validate type + size BEFORE
 * upload → POST create-upload to get { uploadURL, provider, ref } → upload the
 * file to the returned URL → provider-specific post-processing → POST finalize
 * with the final ref (+ optional posterKey for R2).
 *
 * R2 path:
 *   1. Shows a privacy notice with an explicit acceptance checkbox before the
 *      pick button (location data is NOT stripped from R2-stored files).
 *   2. POSTs the file to the worker's r2-upload route (same-origin) with XHR
 *      progress tracking. The route returns { mediaId, r2Key } as the REAL ref
 *      (the placeholder r2Key from createUpload uses .mp4 regardless of MIME).
 *   3. Grabs the first frame via canvas → POSTs to r2-upload-poster.
 *   4. Finalizes with { provider:'r2', mediaId, r2Key, posterKey? }.
 *
 * Stream path:
 *   XHR-POSTs the file straight to Cloudflare (bytes bypass the worker → no
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
    return "Unsupported format. Use MP4, MOV, or WebM.";
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return "Video is too large (max 200 MB).";
  }
  return null;
}

export function VideoCapture({ inspectionId, provider, itemId, onClose, onUploaded }: VideoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  // R2 privacy notice: upload is blocked until the user explicitly accepts.
  const [accepted, setAccepted] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    // Validate type + size client-side (eager-after-error inline message).
    const ve = validateVideoFile(file);
    if (ve) {
      setError(ve);
      return;
    }

    try {
      // Step 1: mint an upload URL + a backend ref.
      const createRes = await fetch(`/api/inspections/${inspectionId}/media/video/create-upload`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemId ? { itemId } : {}),
      });
      if (!createRes.ok) {
        setPhase("pick");
        setError(await apiErrorReason(createRes));
        return;
      }
      const { data } = (await createRes.json()) as {
        data?: {
          uploadURL: string;
          provider: "stream" | "r2";
          ref:
            | { provider: "stream"; streamUid: string }
            | { provider: "r2"; mediaId: string; r2Key: string };
        };
      };
      if (!data?.uploadURL || !data?.ref) {
        setPhase("pick");
        setError("The video service returned an unexpected response. Please try again.");
        return;
      }

      // Step 2: upload the file to the returned URL.
      setPhase("uploading");
      setProgress(0);

      let finalRef:
        | { provider: "stream"; streamUid: string }
        | { provider: "r2"; mediaId: string; r2Key: string; posterKey?: string };

      if (data.ref.provider === "r2") {
        // R2: the upload goes to a same-origin worker route that returns
        // { mediaId, r2Key } in its response body. Use XHR so we get both
        // progress reporting AND the response text.
        let uploadResponseText: string;
        try {
          uploadResponseText = await uploadWithProgressBody(data.uploadURL, file, setProgress);
        } catch {
          setPhase("pick");
          setError("Upload failed. Check your connection and try again.");
          return;
        }

        let r2Data: { mediaId: string; r2Key: string } | undefined;
        try {
          const parsed = JSON.parse(uploadResponseText) as {
            data?: { mediaId: string; r2Key: string };
          };
          r2Data = parsed.data;
        } catch {
          // ignore
        }
        if (!r2Data?.mediaId || !r2Data?.r2Key) {
          setPhase("pick");
          setError("The video service returned an unexpected response. Please try again.");
          return;
        }

        // Step 3: grab the first frame and POST it as the poster JPEG.
        const { mediaId, r2Key } = r2Data;
        let posterKey: string | undefined;
        try {
          const posterBlob = await grabFirstFrame(file);
          if (posterBlob) {
            // Reuse the same upload token — it is embedded in the uploadURL query string.
            const uploadUrlObj = new URL(data.uploadURL);
            const token = uploadUrlObj.searchParams.get("token") ?? "";
            const posterUrl = `/api/inspections/${inspectionId}/media/video/r2-upload-poster?token=${encodeURIComponent(token)}`;
            const posterFd = new FormData();
            posterFd.append("file", posterBlob, "poster.jpg");
            const posterRes = await fetch(posterUrl, {
              method: "POST",
              credentials: "include",
              body: posterFd,
            });
            if (posterRes.ok) {
              const pBody = (await posterRes.json()) as { data?: { posterKey: string } };
              posterKey = pBody.data?.posterKey;
            }
            // Poster failure is non-fatal — finalize without a poster.
          }
        } catch {
          // Non-fatal: poster grab failed (canvas blocked, browser quirk, etc.)
        }

        finalRef = posterKey
          ? { provider: "r2", mediaId, r2Key, posterKey }
          : { provider: "r2", mediaId, r2Key };
      } else {
        // Stream: XHR-POST the file straight to Cloudflare with a progress bar.
        // The bytes bypass the worker — no GPS-leak path through our server.
        try {
          await uploadWithProgress(data.uploadURL, file, setProgress);
        } catch {
          setPhase("pick");
          setError("Upload failed. Check your connection and try again.");
          return;
        }
        finalRef = data.ref as { provider: "stream"; streamUid: string };
      }

      // Step 4: finalize → pool row appears in the strip.
      setPhase("finalizing");
      const finRes = await fetch(`/api/inspections/${inspectionId}/media/video/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalRef),
      });
      if (!finRes.ok) {
        setPhase("pick");
        setError(await apiErrorReason(finRes));
        return;
      }
      const finBody = (await finRes.json()) as {
        data?: { poolId: string };
      };
      const poolId = finBody.data?.poolId ?? "";
      onUploaded({ poolId, provider: finalRef.provider });
      onClose();
    } catch {
      setPhase("pick");
      setError("Upload failed. Check your connection and try again.");
    }
  };

  const busy = phase !== "pick";
  // The pick button is disabled while busy OR (R2 only) until the privacy
  // notice has been accepted.
  const pickDisabled = busy || (provider === "r2" && !accepted);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Add video">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ih-backdrop" onClick={busy ? undefined : onClose} />
      <div data-testid="video-capture" className="relative w-full max-w-md rounded-t-2xl bg-ih-bg-card p-4 shadow-ih-popover">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ih-fg-1">Add video walk-through</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] min-w-[44px] rounded-lg px-3 text-[13px] font-bold text-ih-fg-3 hover:text-ih-fg-1 disabled:opacity-40"
          >
            Cancel
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
            if (f) void handleFile(f);
          }}
        />

        {error && (
          <p data-testid="video-error" role="alert" className="mb-3 rounded-lg bg-ih-bad-bg px-3 py-2 text-[12px] font-semibold text-ih-bad">
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
              This clip is stored as recorded. Location data embedded in the file is{" "}
              <strong>not</strong> removed. I understand and want to upload.
            </span>
          </label>
        )}

        {phase === "uploading" || phase === "finalizing" ? (
          <div className="py-2">
            <div className="mb-1 flex items-center justify-between text-[12px] font-semibold text-ih-fg-2">
              <span>{phase === "finalizing" ? "Processing…" : "Uploading…"}</span>
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
            className="min-h-[44px] w-full rounded-xl bg-ih-primary px-5 text-[14px] font-bold text-white hover:bg-ih-primary-600 disabled:opacity-50"
          >
            Choose or record a clip
          </button>
        )}

        <p className="mt-3 text-[11px] text-ih-fg-4">MP4 / MOV / WebM · up to {MAX_VIDEO_SEC}s · max 200 MB</p>
      </div>
    </div>
  );
}

/**
 * Pull the human-readable reason out of the API's `{ error: { message } }`
 * envelope so the editor can show WHY an upload failed (e.g. the video service
 * is out of quota) instead of a blanket "check your connection". Falls back to
 * a status-coded message when the body has no usable reason.
 */
export async function apiErrorReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    // non-JSON / body already consumed — fall through to the generic message
  }
  return `Upload failed (${res.status}). Please try again.`;
}

/**
 * POST a file with an upload progress callback.
 * Stream path: no response body needed, resolves void on 2xx.
 */
function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload network error"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

/**
 * POST a file with progress tracking, returning the raw response text.
 * Used for the R2 path: the worker r2-upload route returns { mediaId, r2Key }
 * in its JSON body, which we need to build the finalize ref.
 */
export function uploadWithProgressBody(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`upload ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("upload network error"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
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
