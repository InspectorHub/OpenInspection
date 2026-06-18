import { PhotoLightbox } from "./PhotoLightbox";
import { fullResUrl } from "./cropImage";
import type { GalleryPhoto } from "~/lib/inspection-media";

export type MediaAction = "crop" | "annotate" | "rotate" | "cover" | "caption" | "revert" | "delete";

/** Bottom toolbar — single place all per-photo actions live (field-tablet: bottom, 44px). */
export function MediaViewerToolbar({
  kind,
  edited,
  on,
}: {
  kind: "photo" | "video";
  edited: boolean;
  on: (a: MediaAction) => void;
}) {
  // video toolbar is N8; photo toolbar today. Branch on `kind` so the video
  // variant can diverge later without changing this component's surface.
  const isPhoto = kind === "photo";
  const btn = (a: MediaAction, label: string) => (
    <button
      key={a}
      type="button"
      onClick={() => on(a)}
      className="yarl__button"
      style={{ fontSize: 13, fontWeight: 700, padding: "0 12px", color: "#fff" }}
    >
      {label}
    </button>
  );
  const items: React.ReactNode[] = isPhoto
    ? [
        btn("crop", "Crop"),
        btn("annotate", "Annotate"),
        btn("rotate", "Rotate"),
        btn("cover", "Set cover"),
        btn("caption", "Caption"),
      ]
    : [];
  if (isPhoto && edited) items.push(btn("revert", "Revert"));
  if (isPhoto) items.push(btn("delete", "Delete"));
  return <>{items}</>;
}

export interface MediaViewerProps {
  photos: GalleryPhoto[];
  index: number | null;
  onClose: () => void;
  onAction: (action: MediaAction, photo: GalleryPhoto) => void;
}
export function MediaViewer({ photos, index, onClose, onAction }: MediaViewerProps) {
  const viewed = index !== null ? photos[index] : undefined;
  const toolbar = viewed
    ? [
        <MediaViewerToolbar
          key="tb"
          kind="photo"
          edited={!!viewed.annotated}
          on={(a) => {
            onClose();
            onAction(a, viewed);
          }}
        />,
      ]
    : undefined;
  return (
    <PhotoLightbox
      slides={photos.map((p) => ({ src: fullResUrl(p.url), alt: p.label }))}
      index={index ?? 0}
      open={index !== null}
      onClose={onClose}
      toolbarButtons={toolbar}
    />
  );
}
