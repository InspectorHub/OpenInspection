import { PhotoLightbox } from "./PhotoLightbox";
import { VideoPlayer } from "./VideoPlayer";
import { fullResUrl } from "./cropImage";
import { resolveMediaType } from "../../../server/lib/media/media-type";
import type { GalleryPhoto } from "~/lib/inspection-media";
import { m } from "~/paraglide/messages";

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
        {btn("poster", m.media_viewer_poster())}
        {btn("cover", m.media_viewer_cover())}
        {btn("caption", m.media_viewer_caption())}
        {btn("delete", m.common_delete())}
      </>
    );
  }
  const items: React.ReactNode[] = [
    btn("crop", m.media_viewer_crop()),
    btn("annotate", m.media_viewer_annotate()),
    btn("rotate", m.media_viewer_rotate()),
    btn("cover", m.media_viewer_cover()),
    btn("caption", m.media_viewer_caption()),
  ];
  if (edited) items.push(btn("revert", m.media_viewer_revert()));
  items.push(btn("delete", m.common_delete()));
  return <>{items}</>;
}

export interface MediaViewerProps {
  photos: GalleryPhoto[];
  index: number | null;
  onClose: () => void;
  onAction: (action: MediaAction, photo: GalleryPhoto) => void;
  /** Plan 7 — Cloudflare Stream customer subdomain for the video player iframe. */
  streamCustomerSubdomain?: string | null;
  /** Plan 7 — inspection id, used to build r2-object URLs for R2 videos. */
  inspectionId?: string;
}
export function MediaViewer({ photos, index, onClose, onAction, streamCustomerSubdomain, inspectionId }: MediaViewerProps) {
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

  // Plan 7 — a video entry renders the appropriate player as a single "slide"
  // rather than a still image. The lightbox renders arbitrary React via `renderSlide`.
  type VideoSlide = {
    type: "video";
    provider: "stream" | "r2";
    streamUid?: string;
    mediaId?: string;
    alt: string;
  };
  const slides = photos.map((p) =>
    resolveMediaType(p) === "video"
      ? ({
          type: "video" as const,
          provider: p.provider ?? "stream",
          streamUid: p.streamUid,
          mediaId: p.mediaId,
          alt: p.label,
        } as VideoSlide)
      : ({ src: fullResUrl(p.url), alt: p.label }),
  );

  return (
    <PhotoLightbox
      slides={slides}
      index={index ?? 0}
      open={index !== null}
      onClose={onClose}
      toolbarButtons={toolbar}
      renderSlide={(slide) => {
        const vs = slide as VideoSlide | undefined;
        if (vs?.type === "video") {
          if (vs.provider === "r2") {
            return (
              <VideoPlayer
                provider="r2"
                inspectionId={inspectionId}
                mediaId={vs.mediaId}
              />
            );
          }
          return (
            <VideoPlayer
              provider="stream"
              streamUid={vs.streamUid ?? ""}
              streamCustomerSubdomain={streamCustomerSubdomain ?? null}
            />
          );
        }
        return undefined;
      }}
    />
  );
}
