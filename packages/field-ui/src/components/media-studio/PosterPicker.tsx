import { useState } from "react";
import { PENDING_CLASS, pendingProps, useActionLatch, useLayer } from "@core/shared-ui";
import { useFieldDataSource } from "../../context";
import { framesForDuration } from "../../shared/poster-timestamp";
import { m } from "../../i18n";

/**
 * Plan 7 — poster-frame picker (filmstrip → Stream `thumbnailTimestampPct`).
 *
 * A bottom sheet showing N evenly-spaced Cloudflare Stream thumbnail frames for
 * a video. Tap a frame → "Set poster" sends the chosen `posterPct` (0..1) through
 * the data source's `resources.video.setPoster` (a host without it cannot set one).
 *
 * The Stream thumbnail URL needs the account's customer subdomain. The host
 * reads `env.STREAM_CUSTOMER_SUBDOMAIN` server-side and threads it through loader
 * data; if it is absent we fail closed (no fabricated subdomain) and show a
 * "video unavailable" state — never a hardcoded subdomain.
 *
 * No client-side frame extraction: every frame is a Stream-rendered thumbnail.
 * Touch targets are ≥44px (field tablet); the sheet has no hover-only controls.
 */

const FRAME_COUNT = 8;

export function streamThumbUrl(subdomain: string, streamUid: string, sec: number): string {
  return `https://${subdomain}.cloudflarestream.com/${streamUid}/thumbnails/thumbnail.jpg?time=${sec}s`;
}

export interface PosterPickerProps {
  inspectionId: string;
  streamUid: string;
  durationSec: number;
  /** Current poster position (0..1) so the active frame highlights on open. */
  posterPct?: number;
  /** Cloudflare Stream customer subdomain from `env.STREAM_CUSTOMER_SUBDOMAIN`. Null ⇒ unavailable. */
  streamCustomerSubdomain: string | null;
  onClose: () => void;
  /** Deferred to the cover-photo flow (Task 7 wires the real handler). */
  onPickFromPhotos?: () => void;
}

export function PosterPicker({
  inspectionId,
  streamUid,
  durationSec,
  posterPct = 0,
  streamCustomerSubdomain,
  onClose,
  onPickFromPhotos,
}: PosterPickerProps) {
  const frames = framesForDuration(durationSec, FRAME_COUNT);
  // Start on the frame closest to the current poster position.
  const initial = frames.reduce(
    (best, f, i) => (Math.abs(f.pct - posterPct) < Math.abs(frames[best].pct - posterPct) ? i : best),
    0,
  );
  const [selected, setSelected] = useState(initial);
  const video = useFieldDataSource().resources.video;
  const [saving, setSaving] = useState(false);
  const latch = useActionLatch(saving);

  const unavailable = !streamCustomerSubdomain;

  const setPoster = () =>
    latch(() => {
      const f = frames[selected];
      if (!video) return;
      setSaving(true);
      // Same-frame guard above. The answer is not shown: the sheet closes at once, as it always has.
      void video.setPoster(inspectionId, { streamUid, posterPct: f.pct }).then(() => setSaving(false), () => setSaving(false));
      onClose();
    });

  // Full-screen overlay: it takes Escape (and the scroll lock) so a dialog under it stays put.
  useLayer(true, { onEscape: onClose, lockScroll: true });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={m.media_poster_heading()}>
      <button type="button" aria-label={m.common_close()} className="absolute inset-0 bg-ih-backdrop" onClick={onClose} />
      <div
        data-testid="poster-picker"
        className="relative w-full max-w-2xl rounded-t-2xl bg-ih-bg-card p-4 shadow-ih-popover"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ih-fg-1">{m.media_poster_heading()}</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-lg px-3 text-[13px] font-bold text-ih-fg-3 hover:text-ih-fg-1"
          >
            {m.common_cancel()}
          </button>
        </div>

        {unavailable ? (
          <p data-testid="poster-unavailable" className="py-8 text-center text-[13px] text-ih-fg-3">
            {m.media_poster_unavailable()}
          </p>
        ) : (
          <div className="-mx-1 flex gap-2 overflow-x-auto pb-2" style={{ touchAction: "pan-x" }}>
            {frames.map((f) => (
              <button
                key={f.index}
                type="button"
                data-testid={`poster-frame-${f.index}`}
                aria-pressed={selected === f.index}
                onClick={() => setSelected(f.index)}
                className={`relative h-[72px] w-[120px] shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                  selected === f.index ? "border-ih-primary" : "border-ih-border hover:border-ih-primary/60"
                }`}
              >
                <img
                  src={streamThumbUrl(streamCustomerSubdomain!, streamUid, Math.round(f.sec))}
                  alt={m.media_poster_frame_alt({ sec: Math.round(f.sec) })}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onPickFromPhotos}
            disabled={!onPickFromPhotos}
            className="min-h-[44px] rounded-xl px-3 text-[13px] font-bold text-ih-primary-text hover:text-ih-primary-600 disabled:opacity-40"
          >
            {m.media_poster_pick_from_photos()}
          </button>
          <button
            type="button"
            {...pendingProps(unavailable || saving || !video, setPoster)}
            className={`min-h-[44px] rounded-xl bg-ih-primary px-5 text-[14px] font-bold text-ih-fg-inverse hover:bg-ih-primary-600 ${PENDING_CLASS}`}
          >
            {m.media_poster_set()}
          </button>
        </div>
      </div>
    </div>
  );
}
