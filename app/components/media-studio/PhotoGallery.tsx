import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { PhotoGrid } from "./PhotoGrid";
import { MediaViewer } from "./MediaViewer";
import type { GalleryPhoto } from "~/lib/inspection-media";
import { m } from "~/paraglide/messages";

export interface PhotoGalleryProps {
  inspectionId: string;
  onSetCover: (photo: { key: string; url: string }) => void;
  onAnnotate: (photo: { key: string; url: string }) => void;
}
export function PhotoGallery({ inspectionId, onSetCover, onAnnotate }: PhotoGalleryProps) {
  const load = useFetcher<{ photos: GalleryPhoto[]; answered: boolean }>();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const photos = load.data?.photos ?? [];
  const href = `/resources/inspection-media?inspectionId=${encodeURIComponent(inspectionId)}`;
  useEffect(() => {
    if (inspectionId) load.load(href);
  }, [inspectionId]);

  // Three states, because this panel had two and one of them was doing the work
  // of three (F57). "No photos in this inspection yet." is a statement about the
  // INSPECTION, so it may only be made on an answer that came back and said so:
  // an empty list was also what a load-in-flight, a dropped request and a 4xx
  // looked like from here, and each of those rendered as a confident claim that
  // the inspector's photos did not exist.
  if (!load.data) return <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.media_gallery_loading()}</p>;
  if (!load.data.answered) {
    return (
      <div className="text-center py-8 space-y-2">
        <p className="text-[13px] text-ih-fg-3">{m.media_gallery_unavailable()}</p>
        <button
          type="button"
          onClick={() => load.load(href)}
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
        index={lightbox}
        onClose={() => setLightbox(null)}
        onAction={(a, p) => {
          if (a === "cover") onSetCover({ key: p.key, url: p.url });
          else if (a === "annotate") onAnnotate({ key: p.key, url: p.url });
          // crop/rotate/caption/revert/delete wired by the parent in a later dispatch
        }}
      />
    </div>
  );
}
