import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoGrid } from "./PhotoGrid";
import { MediaViewer, ALL_MEDIA_ACTIONS, type MediaAction } from "./MediaViewer";
import { useReadOnly } from "../../read-only";
import { useFieldDataSource, usePhotoUrlVersion } from "../../context";
import type { MediaPoolListing } from "../../data-source-types";
import type { GalleryPhoto } from "../../shared/inspection-media";
import { m } from "../../i18n";

/**
 * The drawer lists photos from every section and unit, but the editor resolves a
 * photo's place in the results document through the section that is open, so
 * deleting, cropping or captioning from here could change the wrong entry or
 * none. Only cover and annotate are handled; the rest are not offered (they used
 * to be buttons that closed the viewer and did nothing).
 */
export const GALLERY_UNHANDLED_ACTIONS: readonly MediaAction[] = ["crop", "rotate", "caption", "revert", "delete", "poster"];

const NO_ANNOTATE_ACTIONS: readonly MediaAction[] = [...GALLERY_UNHANDLED_ACTIONS, "annotate"];

/**
 * A studio opened from here saves onto `photos[photoIndex]` of the row's item, so Annotate is offered only for a photo
 * attached to an item. A defect's photo is indexed inside the defect, and a loose pool photo belongs to no item.
 */
// Results are keyed unit:section:item and the editor follows the open unit, so a row from another unit is left out too.
const COMMON_SCOPE = "_default";
const canAnnotate = (p: GalleryPhoto | undefined, activeUnitId: string | null): boolean =>
  !!p && !!p.itemId && p.photoIndex != null && !p.defectId && p.mediaType !== "video" && (p.unitId ?? COMMON_SCOPE) === (activeUnitId ?? COMMON_SCOPE);

export interface PhotoGalleryProps {
  inspectionId: string;
  /** The open unit (null = the common scope): only its photos can be annotated from here. */
  activeUnitId?: string | null;
  /** The report cover, so the viewer can say which photo is it. */
  coverKey?: string | null;
  /** Shows a listed photo as the editor has it now (the listing can be behind a save). */
  liveRow?: (photo: GalleryPhoto) => GalleryPhoto;
  onSetCover: (photo: { key: string; url: string }) => void;
  /** Gets the whole row: the editor needs its item, section and index to save onto the right photo. */
  onAnnotate: (photo: GalleryPhoto) => void;
}
export function PhotoGallery({ inspectionId, activeUnitId = null, coverKey = null, liveRow, onSetCover, onAnnotate }: PhotoGalleryProps) {
  const mediaPool = useFieldDataSource().resources.mediaPool;
  const readOnly = useReadOnly();
  const photoUrlVersion = usePhotoUrlVersion();
  // null until the first answer. A reload keeps the previous answer on screen until the next one lands.
  const [listing, setListing] = useState<MediaPoolListing | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const photos = (listing?.photos ?? []).map((p) => liveRow?.(p) ?? p);
  // The newest read wins: an answer for an earlier read (or another inspection) is dropped.
  const latestRead = useRef(0);
  const load = useCallback(() => {
    const read = (latestRead.current += 1);
    // A host without the pool answers "no answer", which offers a retry rather than claiming the pool is empty.
    void (mediaPool?.list(inspectionId) ?? Promise.resolve<MediaPoolListing>({ photos: [], answered: false })).then((next) => {
      if (read === latestRead.current) setListing(next);
    });
  }, [mediaPool, inspectionId]);
  useEffect(() => {
    if (inspectionId) load();
    return () => {
      latestRead.current += 1;
    };
  }, [inspectionId, load, photoUrlVersion]);

  // Three states, because this panel had two and one of them was doing the work
  // of three (F57). "No photos in this inspection yet." is a statement about the
  // INSPECTION, so it may only be made on an answer that came back and said so:
  // an empty list was also what a load-in-flight, a dropped request and a 4xx
  // looked like from here, and each of those rendered as a confident claim that
  // the inspector's photos did not exist.
  if (!listing) return <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.media_gallery_loading()}</p>;
  if (!listing.answered) {
    return (
      <div className="text-center py-8 space-y-2">
        <p className="text-[13px] text-ih-fg-3">{m.media_gallery_unavailable()}</p>
        <button
          type="button"
          onClick={load}
          className="text-[12px] font-bold text-ih-primary-text hover:underline"
        >
          {m.editor_collab_try_again()}
        </button>
      </div>
    );
  }
  if (photos.length === 0) return <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.media_gallery_empty()}</p>;
  return (
    <div className="space-y-3">
      <PhotoGrid items={photos.map((p) => ({ key: p.key, src: p.url, width: 4, height: 3, label: p.label }))} onClick={(i) => setLightbox(i)} />
      <MediaViewer
        photos={photos}
        coverKey={coverKey}
        index={lightbox}
        onClose={() => setLightbox(null)}
        hideActions={readOnly ? ALL_MEDIA_ACTIONS : (shown) => (canAnnotate(shown, activeUnitId) ? GALLERY_UNHANDLED_ACTIONS : NO_ANNOTATE_ACTIONS)}
        onAction={(a, p) => {
          if (a === "cover") onSetCover({ key: p.key, url: p.url });
          else if (a === "annotate") onAnnotate(p);
        }}
      />
    </div>
  );
}
