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
  const load = useFetcher<{ photos: GalleryPhoto[] }>();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const photos = load.data?.photos ?? [];
  useEffect(() => {
    if (inspectionId) load.load(`/resources/inspection-media?inspectionId=${encodeURIComponent(inspectionId)}`);
  }, [inspectionId]);
  if (load.state === "loading" && photos.length === 0) return <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.media_gallery_loading()}</p>;
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
