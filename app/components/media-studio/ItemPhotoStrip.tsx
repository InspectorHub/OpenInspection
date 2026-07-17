import { useEffect, useRef, useState } from "react";
import Sortable from "sortablejs";
import { Button } from "@core/shared-ui";
import { resolvePhotoDisplayKey } from "./photo-display-key";
import { m } from "~/paraglide/messages";

export interface StripPhoto {
  key: string;
  croppedKey?: string;
  annotatedKey?: string;
  /** Plan 7 — media discriminator. Absent ⇒ photo. */
  mediaType?: "photo" | "video";
  /** Plan 7 — Cloudflare Stream UID (video entries). */
  streamUid?: string;
  /** Plan 7 — poster timestamp (0..1) for the Stream poster thumbnail. */
  posterPct?: number;
  /** Plan 7 — duration in seconds, rendered as an m:ss badge. */
  durationSec?: number;
  /** #181 PR-G — true while the binary is only in the local pending store. */
  pendingUpload?: boolean;
  /** #181 PR-G — id into the local media-pending store (resolves to a blob URL). */
  pendingId?: string;
  /** #181 PR-G — which offline op produced this pending entry. */
  pendingKind?: "photo" | "crop" | "annotate";
}

/** Plan 7 — format a duration in seconds as m:ss (e.g. 75 → "1:15"). */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export interface ItemPhotoStripProps {
  inspectionId: string;
  itemId: string;
  photos: StripPhoto[];
  coverKey: string | null;
  photoUrl: (key: string) => string;
  onAddPhoto: () => void;
  onOpen: (index: number) => void;
  /**
   * Emit the new photo order. CONTRACT: the array is the ORIGINAL `key` order
   * (NOT displayKey) — the server `reorderItemPhotos` route matches the stored
   * `photos[].key`. We render the <img> from displayKey but reorder by key.
   */
  onReorder?: (order: string[]) => void;
  photoUploading?: boolean;
  /** Task 9 — show the "Select" toggle + enable long-press multi-select. */
  selectable?: boolean;
  /**
   * Task 9 — detach the selected photos. Indices are emitted DESC (high→low) so
   * the caller can splice/POST them in order without invalidating earlier indices.
   */
  onBulkDetach?: (indices: number[]) => void;
  /**
   * Task 9b — the OTHER items this strip's photos can be moved to. When present
   * (and non-empty), the bulk bar shows a "Move to" picker next to Delete.
   */
  moveTargets?: Array<{ itemId: string; label: string; sectionId?: string }>;
  /**
   * Task 9b — move the selected photos to the chosen target item/section.
   * Indices are emitted DESC (high→low), mirroring {@link onBulkDetach}, so the
   * caller can POST them one per round trip without invalidating earlier indices.
   */
  onBulkMove?: (indices: number[], to: { itemId: string; sectionId?: string }) => void;
  /**
   * Plan 7 — resolve a Stream poster thumbnail URL for a video entry. Returns
   * null when the Stream customer subdomain is unavailable (fail closed) — the
   * strip then shows a neutral video placeholder instead of a broken image.
   */
  videoPosterUrl?: (streamUid: string, posterPct?: number) => string | null;
  /**
   * #181 PR-G — resolve the LOCAL blob objectURL for a pending (offline) entry's
   * `pendingId`. Returns undefined when this client does not own the blob (the
   * entry was captured on another device) — the strip then shows an "uploading…"
   * placeholder instead of a broken image.
   */
  pendingPhotoUrl?: (pendingId: string) => string | undefined;
}

/** The visible thumbnail = the edited derivative when present, else the original.
 *  Plan 4: delegates to the shared resolver (annotatedKey || croppedKey || key). */
const displayKey = (p: StripPhoto) => resolvePhotoDisplayKey(p);

export function ItemPhotoStrip({
  inspectionId: _inspectionId,
  itemId: _itemId,
  photos,
  coverKey,
  photoUrl,
  onAddPhoto,
  onOpen,
  onReorder,
  photoUploading,
  selectable,
  onBulkDetach,
  moveTargets,
  onBulkMove,
  videoPosterUrl,
  pendingPhotoUrl,
}: ItemPhotoStripProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  // Task 9 — Drive-style multi-select. `selecting` flips the strip into select
  // mode (tap toggles instead of opening); `sel` holds the chosen indices.
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  // Long-press timer: 450ms — DELIBERATELY longer than SortableJS's 180ms drag
  // delay so a held-and-moved press = drag, a held-and-still press = select.
  const lp = useRef<ReturnType<typeof setTimeout>>();

  const toggle = (i: number) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const exitSelect = () => {
    setSelecting(false);
    setSel(new Set());
  };

  const startLongPress = (i: number) => {
    if (!selectable) return;
    clearTimeout(lp.current);
    lp.current = setTimeout(() => {
      setSelecting(true);
      toggle(i);
    }, 450);
  };
  const cancelLongPress = () => clearTimeout(lp.current);
  // Keep the latest photos/onReorder for the SortableJS onEnd closure without
  // re-creating the Sortable instance on every photos change (drag would break
  // mid-gesture). The instance reads these refs at drop time.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  useEffect(() => {
    if (!rowRef.current || !onReorder) return;
    const s = Sortable.create(rowRef.current, {
      animation: 150,
      // long-press to drag on touch; a quick tap = open; horizontal swipe = scroll
      delay: 180,
      delayOnTouchOnly: true,
      draggable: ".strip-thumb",
      filter: ".strip-add", // the + tile is never draggable
      onEnd: (evt) => {
        if (evt.oldIndex == null || evt.newIndex == null || evt.oldIndex === evt.newIndex) return;
        // Build the ORIGINAL-key order (server matches photos[].key, NOT displayKey).
        const keys = photosRef.current.map((p) => p.key);
        const [moved] = keys.splice(evt.oldIndex, 1);
        keys.splice(evt.newIndex, 0, moved);
        onReorderRef.current?.(keys);
      },
    });
    return () => s.destroy();
    // Re-init only when reorder is toggled on/off. The onEnd closure reads
    // photosRef/onReorderRef so a photos change does not need to re-create the
    // Sortable instance (which would break a drag mid-gesture).
  }, [onReorder]);

  const showSelectToggle = selectable && (!!onBulkDetach || !!onBulkMove) && photos.length > 0;

  return (
    <div>
      {showSelectToggle && (
        <div className="flex items-center justify-between mb-2">
          {selecting ? (
            <>
              <Button variant="ghost" size="sm" onClick={exitSelect}>
                {m.common_cancel()}
              </Button>
              <div className="flex items-center gap-3">
                {onBulkMove && moveTargets && moveTargets.length > 0 && (
                  <label className="flex items-center gap-1 text-[12px] font-bold text-ih-fg-2">
                    {m.media_strip_move_to()}
                    <select
                      className="h-8 rounded-lg border border-ih-border bg-ih-surface px-2 text-[12px] disabled:opacity-40"
                      defaultValue=""
                      disabled={sel.size === 0}
                      onChange={(e) => {
                        const t = moveTargets.find((mt) => mt.itemId === e.target.value);
                        e.currentTarget.value = "";
                        if (!t) return;
                        onBulkMove([...sel].sort((a, b) => b - a), { itemId: t.itemId, sectionId: t.sectionId });
                        exitSelect();
                      }}
                    >
                      <option value="" disabled>
                        {m.media_strip_choose_item()}
                      </option>
                      {moveTargets.map((mt) => (
                        <option key={mt.itemId} value={mt.itemId}>
                          {mt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {onBulkDetach && (
                  <Button
                    variant="danger-link"
                    size="sm"
                    disabled={sel.size === 0}
                    onClick={() => {
                      onBulkDetach([...sel].sort((a, b) => b - a));
                      exitSelect();
                    }}
                  >
                    {m.media_strip_delete_count({ count: sel.size })}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Button variant="link" size="sm" onClick={() => setSelecting(true)} className="ml-auto">
              {m.media_strip_select()}
            </Button>
          )}
        </div>
      )}
      <div
        ref={rowRef}
        className="flex flex-wrap items-center gap-2 overflow-x-auto"
        style={{ touchAction: "pan-x" }}
      >
        {photos.map((p, i) => {
          const dk = displayKey(p);
          const isCover = coverKey != null && coverKey === dk;
          const checked = sel.has(i);
          // Plan 7 — video entries render the Stream poster as the thumb + a
          // play-glyph + an m:ss duration badge; the cover ring is preserved.
          const isVideo = p.mediaType === "video" && !!p.streamUid;
          const posterSrc = isVideo ? (videoPosterUrl?.(p.streamUid!, p.posterPct) ?? null) : null;
          // #181 PR-G — pending (offline) entry. Prefer the LOCAL blob URL; fall
          // back to the base key (pending crop/annotate keep their base) or a
          // placeholder (another device's offline capture — no local blob).
          const isPending = !!p.pendingId;
          const localUrl = p.pendingId ? pendingPhotoUrl?.(p.pendingId) : undefined;
          const pendingSrc = isPending ? (localUrl ?? (dk ? photoUrl(dk) : undefined)) : undefined;
          return (
            <button
              key={dk || p.pendingId || `idx-${i}`}
              type="button"
              data-testid={`thumb-${i}`}
              onClick={() => (selecting ? toggle(i) : onOpen(i))}
              onPointerDown={() => startLongPress(i)}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              className={`strip-thumb relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${
                isCover
                  ? "is-cover border-ih-primary"
                  : checked
                    ? "border-ih-primary"
                    : "border-ih-border hover:border-ih-primary/60"
              }`}
            >
              {isVideo ? (
                <>
                  {posterSrc ? (
                    <img src={posterSrc} alt="" className="w-full h-full object-cover" loading="lazy" draggable={false} />
                  ) : (
                    <span data-testid={`video-placeholder-${i}`} className="flex w-full h-full items-center justify-center bg-ih-bg-muted" />
                  )}
                  <span
                    data-testid={`video-play-${i}`}
                    className="absolute inset-0 flex items-center justify-center text-white"
                    aria-hidden="true"
                  >
                    <svg className="w-5 h-5 drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                  {typeof p.durationSec === "number" && p.durationSec > 0 && (
                    <span
                      data-testid={`video-dur-${i}`}
                      /* ds-allow: fixed-dark duration chip over a video thumbnail, needs contrast on any frame */
                      className="absolute bottom-0.5 right-0.5 rounded bg-[rgba(15,23,42,0.7)] px-1 text-[9px] font-bold tabular-nums text-white"
                    >
                      {formatDuration(p.durationSec)}
                    </span>
                  )}
                </>
              ) : isPending ? (
                <>
                  {pendingSrc ? (
                    <img
                      src={pendingSrc}
                      alt=""
                      className="w-full h-full object-cover opacity-70"
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <span
                      data-testid={`pending-placeholder-${i}`}
                      className="flex w-full h-full items-center justify-center bg-ih-bg-muted"
                    />
                  )}
                  <span
                    data-testid={`pending-badge-${i}`}
                    className="absolute inset-x-0 bottom-0 bg-ih-watch-bg text-ih-watch-fg text-[8px] font-bold text-center py-0.5 uppercase tracking-wide"
                  >
                    {m.media_strip_uploading()}
                  </span>
                </>
              ) : (
                <img
                  src={photoUrl(dk)}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              )}
              {selecting && (
                <span
                  data-testid={`check-${i}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(i);
                  }}
                  className={`absolute top-1 left-1 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    checked ? "bg-ih-primary border-ih-primary" : "bg-ih-bg-card/80 border-ih-border"
                  }`}
                >
                  {checked && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              )}
              {isCover && !selecting && (
                <span className="absolute inset-x-0 bottom-0 bg-ih-primary text-white text-[8px] font-bold text-center py-0.5 uppercase tracking-wide">
                  {m.media_strip_cover()}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAddPhoto}
          disabled={photoUploading}
          aria-label={m.media_strip_add_photo_aria()}
          className="strip-add w-16 h-16 shrink-0 rounded-lg border-2 border-dashed border-ih-border flex items-center justify-center text-ih-fg-4 hover:border-ih-primary hover:text-ih-primary transition-colors disabled:opacity-50"
        >
          {photoUploading ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
