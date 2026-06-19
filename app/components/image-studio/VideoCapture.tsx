import { useRef, useState } from "react";

/**
 * Plan 7 — video walk-through capture + Cloudflare Stream direct-creator-upload.
 *
 * Flow: pick/capture a clip → validate BEFORE upload (type allowlist, ≤200 MB,
 * ≤30 s via a hidden <video> metadata probe) → POST create-upload to mint a
 * one-shot Stream uploadURL → XHR-POST the file straight to Cloudflare with an
 * onprogress bar (bytes bypass the worker → no GPS-leak path) → on 200, POST
 * finalize so the pool row appears in the strip.
 *
 * Offline: video does NOT use the offline photo queue (clip sizes make
 * IndexedDB replay impractical). When offline the add tile is disabled with a
 * "Video upload requires a connection" hint — enforced by the host.
 */

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_VIDEO_SEC = 30;
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

export interface VideoCaptureProps {
  inspectionId: string;
  /** Optional placement intent forwarded to create-upload. */
  itemId?: string;
  onClose: () => void;
  /** Called after finalize succeeds so the host can refresh the strip. */
  onUploaded: (streamUid: string) => void;
}

type Phase = "pick" | "validating" | "uploading" | "finalizing";

/** Read a clip's duration (seconds) via a hidden <video> loadedmetadata event. */
export function probeDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata"));
    };
    v.src = url;
  });
}

/** Pure validation (type + size). Duration is checked separately (async probe). */
export function validateVideoFile(file: File): string | null {
  if (!(ALLOWED_VIDEO_TYPES as readonly string[]).includes(file.type)) {
    return "Unsupported format. Use MP4, MOV, or WebM.";
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return "Video is too large (max 200 MB).";
  }
  return null;
}

export function VideoCapture({ inspectionId, itemId, onClose, onUploaded }: VideoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const handleFile = async (file: File) => {
    setError(null);
    // 1. type + size (eager-after-error inline message)
    const ve = validateVideoFile(file);
    if (ve) {
      setError(ve);
      return;
    }
    // 2. duration probe
    setPhase("validating");
    let durationSec: number;
    try {
      durationSec = await probeDuration(file);
    } catch {
      setPhase("pick");
      setError("Could not read this video. Try a different clip.");
      return;
    }
    if (durationSec > MAX_VIDEO_SEC) {
      setPhase("pick");
      setError(`Clip is too long (${Math.round(durationSec)}s). Max ${MAX_VIDEO_SEC}s.`);
      return;
    }

    // 3. create-upload → mint a one-shot Stream uploadURL
    try {
      const createRes = await fetch(`/api/inspections/${inspectionId}/media/video/create-upload`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemId ? { itemId } : {}),
      });
      if (!createRes.ok) throw new Error("create-upload failed");
      const { data } = (await createRes.json()) as { data?: { uploadURL: string; streamUid: string } };
      if (!data?.uploadURL || !data?.streamUid) throw new Error("create-upload missing fields");

      // 4. XHR POST the file straight to Cloudflare with a progress bar.
      setPhase("uploading");
      setProgress(0);
      await uploadWithProgress(data.uploadURL, file, setProgress);

      // 5. finalize → pool row appears in the strip.
      setPhase("finalizing");
      const finRes = await fetch(`/api/inspections/${inspectionId}/media/video/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamUid: data.streamUid }),
      });
      if (!finRes.ok) throw new Error("finalize failed");
      onUploaded(data.streamUid);
      onClose();
    } catch {
      setPhase("pick");
      setError("Upload failed. Check your connection and try again.");
    }
  };

  const busy = phase !== "pick";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Add video">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-[rgba(15,23,42,0.4)]" onClick={busy ? undefined : onClose} />
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
            onClick={() => inputRef.current?.click()}
            disabled={phase === "validating"}
            className="min-h-[44px] w-full rounded-xl bg-ih-primary px-5 text-[14px] font-bold text-white hover:bg-ih-primary-600 disabled:opacity-50"
          >
            {phase === "validating" ? "Checking clip…" : "Choose or record a clip"}
          </button>
        )}

        <p className="mt-3 text-[11px] text-ih-fg-4">MP4 / MOV / WebM · up to {MAX_VIDEO_SEC}s · max 200 MB</p>
      </div>
    </div>
  );
}

/** POST a file with an upload progress callback (Stream direct-upload is a single multipart POST). */
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
