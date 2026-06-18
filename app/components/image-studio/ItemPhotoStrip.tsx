import { useEffect, useRef } from "react";
import Sortable from "sortablejs";

export interface StripPhoto {
  key: string;
  annotatedKey?: string;
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
}

/** The visible thumbnail = the edited derivative when present, else the original. */
const displayKey = (p: StripPhoto) => p.annotatedKey || p.key;

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
}: ItemPhotoStripProps) {
  const rowRef = useRef<HTMLDivElement>(null);
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

  return (
    <div
      ref={rowRef}
      className="flex flex-wrap items-center gap-2 overflow-x-auto"
      style={{ touchAction: "pan-x" }}
    >
      {photos.map((p, i) => {
        const dk = displayKey(p);
        const isCover = coverKey != null && coverKey === dk;
        return (
          <button
            key={dk}
            type="button"
            data-testid={`thumb-${i}`}
            onClick={() => onOpen(i)}
            className={`strip-thumb relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border-2 transition-colors ${
              isCover
                ? "is-cover border-ih-primary"
                : "border-ih-border hover:border-ih-primary/60"
            }`}
          >
            <img
              src={photoUrl(dk)}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              draggable={false}
            />
            {isCover && (
              <span className="absolute inset-x-0 bottom-0 bg-ih-primary text-white text-[8px] font-bold text-center py-0.5 uppercase tracking-wide">
                Cover
              </span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAddPhoto}
        disabled={photoUploading}
        aria-label="Add photo"
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
  );
}
