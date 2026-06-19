import { PhotoLightbox } from "./PhotoLightbox";
import { VideoPlayer } from "./VideoPlayer";
import { fullResUrl } from "./cropImage";
import { resolveMediaType } from "../../../server/lib/media/media-type";
import type { GalleryPhoto } from "~/lib/inspection-media";

export type MediaAction = "crop" | "annotate" | "rotate" | "cover" | "caption" | "revert" | "delete" | "poster";

/** Bottom toolbar — single place all per-media actions live (field-tablet: bottom, 44px). */
export function MediaViewerToolbar({
  kind,
  edited,
  on,
}: {
  kind: "photo" | "video";
  edited: boolean;
  on: (a: MediaAction) => void;
}) {
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
  // Plan 7 — video gets a LOCKED minimal toolbar: poster · cover · caption ·
  // delete. NO crop / annotate / rotate / revert (out of v1). Photo unchanged.
  if (kind === "video") {
    return (
      <>
        {btn("poster", "Poster frame")}
        {btn("cover", "Set cover")}
        {btn("caption", "Caption")}
        {btn("delete", "Delete")}
      </>
    );
  }
  const items: React.ReactNode[] = [
    btn("crop", "Crop"),
    btn("annotate", "Annotate"),
    btn("rotate", "Rotate"),
    btn("cover", "Set cover"),
    btn("caption", "Caption"),
  ];
  if (edited) items.push(btn("revert", "Revert"));
  items.push(btn("delete", "Delete"));
  return <>{items}</>;
}

export interface MediaViewerProps {
  photos: GalleryPhoto[];
  index: number | null;
  onClose: () => void;
  onAction: (action: MediaAction, photo: GalleryPhoto) => void;
  /** Plan 7 — Cloudflare Stream customer subdomain for the video player iframe. */
  streamCustomerSubdomain?: string | null;
}
export function MediaViewer({ photos, index, onClose, onAction, streamCustomerSubdomain }: MediaViewerProps) {
  const viewed = index !== null ? photos[index] : undefined;
  const kind = viewed ? resolveMediaType(viewed) : "photo";

  const toolbar = viewed
    ? [
        <MediaViewerToolbar
          key="tb"
          kind={kind}
          edited={!!viewed.annotated}
          on={(a) => {
            onClose();
            onAction(a, viewed);
          }}
        />,
      ]
    : undefined;

  // Plan 7 — a video entry renders the Stream player as a single "slide" rather
  // than a still image. The lightbox renders arbitrary React via `renderSlide`.
  const slides = photos.map((p) =>
    resolveMediaType(p) === "video"
      ? ({ type: "video-stream" as const, streamUid: p.streamUid ?? "", alt: p.label })
      : ({ src: fullResUrl(p.url), alt: p.label }),
  );

  return (
    <PhotoLightbox
      slides={slides}
      index={index ?? 0}
      open={index !== null}
      onClose={onClose}
      toolbarButtons={toolbar}
      renderSlide={(slide) =>
        slide && (slide as { type?: string }).type === "video-stream" ? (
          <VideoPlayer
            streamUid={(slide as { streamUid: string }).streamUid}
            streamCustomerSubdomain={streamCustomerSubdomain ?? null}
          />
        ) : undefined
      }
    />
  );
}
