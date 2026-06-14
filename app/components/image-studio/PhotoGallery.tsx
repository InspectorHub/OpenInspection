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
  return (
    <div className="space-y-3">
      <PhotoGrid items={photos.map((p) => ({ key: p.key, src: p.url, width: 4, height: 3, label: p.label }))} onClick={(i) => setLightbox(i)} />
      <PhotoLightbox slides={photos.map((p) => ({ src: fullResUrl(p.url), alt: p.label }))} index={lightbox ?? 0} open={lightbox !== null} onClose={() => setLightbox(null)} />
      {lightbox !== null && photos[lightbox] && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onAnnotate({ key: photos[lightbox].key, url: photos[lightbox].url })} className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:border-ih-primary hover:text-ih-primary">Annotate</button>
          <button type="button" onClick={() => onSetCover({ key: photos[lightbox].key, url: photos[lightbox].url })} className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:border-ih-primary hover:text-ih-primary">Set as cover</button>
        </div>
      )}
    </div>
  );
}
