import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { PhotoGrid } from "./PhotoGrid";
import { PhotoLightbox } from "./PhotoLightbox";
import { fullResUrl } from "./cropImage";
import type { GalleryPhoto } from "~/lib/inspection-media";

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
  if (load.state === "loading" && photos.length === 0) return <p className="text-[13px] text-ih-fg-3 text-center py-8">Loading photos…</p>;
  if (photos.length === 0) return <p className="text-[13px] text-ih-fg-3 text-center py-8">No photos in this inspection yet.</p>;
  // Action buttons live in the lightbox toolbar so they act on the photo being
  // viewed (the fullscreen YARL overlay covers any side-panel controls).
  const viewed = lightbox !== null ? photos[lightbox] : undefined;
  const toolbarButtons = viewed
    ? [
        <button
          key="annotate"
          type="button"
          onClick={() => {
            setLightbox(null);
            onAnnotate({ key: viewed.key, url: viewed.url });
          }}
          className="yarl__button"
          style={{ fontSize: 13, fontWeight: 700, padding: "0 12px", color: "#fff" }}
        >
          Annotate
        </button>,
        <button
          key="set-cover"
          type="button"
          onClick={() => {
            setLightbox(null);
            onSetCover({ key: viewed.key, url: viewed.url });
          }}
          className="yarl__button"
          style={{ fontSize: 13, fontWeight: 700, padding: "0 12px", color: "#fff" }}
        >
          Set as cover
        </button>,
      ]
    : undefined;
  return (
    <div className="space-y-3">
      <PhotoGrid items={photos.map((p) => ({ key: p.key, src: p.url, width: 4, height: 3, label: p.label }))} onClick={(i) => setLightbox(i)} />
      <PhotoLightbox
        slides={photos.map((p) => ({ src: fullResUrl(p.url), alt: p.label }))}
        index={lightbox ?? 0}
        open={lightbox !== null}
        onClose={() => setLightbox(null)}
        toolbarButtons={toolbarButtons}
      />
    </div>
  );
}
