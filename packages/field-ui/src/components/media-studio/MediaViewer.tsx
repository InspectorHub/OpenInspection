import { useEffect, useState } from "react";
import { PhotoLightbox } from "./PhotoLightbox";
import { useMaxWidth } from "../../hooks/useBreakpoint";
import { VideoPlayer } from "./VideoPlayer";
import { fullResUrl } from "./cropImage";
import { resolveMediaType } from "../../shared/media-type";
import type { GalleryPhoto } from "../../shared/inspection-media";
import { m } from "../../i18n";

export type MediaAction = "crop" | "annotate" | "rotate" | "cover" | "caption" | "revert" | "delete" | "poster";

/** Every toolbar action. Each one changes the photo or the inspection, so a read-only viewer hides them all. */
export const ALL_MEDIA_ACTIONS: readonly MediaAction[] = ["crop", "annotate", "rotate", "cover", "caption", "revert", "delete", "poster"];

/** Bottom toolbar — single place all per-media actions live (field-tablet: bottom, 44px). */
export function MediaViewerToolbar({
  kind,
  provider,
  edited,
  on,
  hide,
  compact = false,
  isCover = false,
}: {
  kind: "photo" | "video";
  /** Video backend. An R2 clip has no poster picker (its poster is the frame captured at upload); absent means Stream. */
  provider?: "stream" | "r2";
  edited: boolean;
  on: (a: MediaAction) => void;
  /** The photo on screen is the report cover: the cover action reads as an adjustment, not as setting it. */
  isCover?: boolean;
  /** A narrow screen: 44px targets that keep their label on one line and never shrink (the bar wraps instead). */
  compact?: boolean;
  /** Actions the parent does not handle; they are left out rather than shown dead. */
  hide?: readonly MediaAction[];
}) {
  const btn = (a: MediaAction, label: string) => hide?.includes(a) ? null : (
    <button
      key={a}
      type="button"
      onClick={() => on(a)}
      className={compact ? "yarl__button min-h-11 min-w-11 whitespace-nowrap shrink-0" : "yarl__button"}
      style={{ fontSize: 13, fontWeight: 700, padding: "0 12px", color: "#fff" }}
    >
      {label}
    </button>
  );
  const cover = isCover ? m.media_viewer_cover_adjust() : m.media_viewer_cover();
  // A video gets a LOCKED minimal toolbar: poster frame (Stream only) · caption · delete. No crop / annotate / rotate / revert,
  // and never "cover": the report cover is a still image. Photo unchanged.
  if (kind === "video") {
    return (
      <>
        {provider === "r2" ? null : btn("poster", m.media_viewer_poster())}
        {btn("caption", m.media_viewer_caption())}
        {btn("delete", m.common_delete())}
      </>
    );
  }
  const items: React.ReactNode[] = [
    btn("crop", m.media_viewer_crop()),
    btn("annotate", m.media_viewer_annotate()),
    btn("rotate", m.media_viewer_rotate()),
    btn("cover", cover),
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
  /** Toolbar actions the parent does not handle; they are not offered. */
  hideActions?: readonly MediaAction[] | ((shown: GalleryPhoto) => readonly MediaAction[] | undefined);
  /** The inspection's report cover (the key a photo shows): the photo that is it offers "Adjust cover" instead of "Set cover". */
  coverKey?: string | null;
}
export function MediaViewer({ photos, index, onClose, onAction, streamCustomerSubdomain, inspectionId, hideActions, coverKey }: MediaViewerProps) {
  // The slide ON SCREEN. `index` only says where the viewer was opened; the lightbox then moves on its own (Next/Prev,
  // arrow keys, swipe), so the toolbar must follow what it reports, or an action (Delete included) would act on the
  // photo the viewer was opened on while another is shown.
  // A clip has no file key (it is ''), so identify a slide by its media id when the key is empty.
  const idOf = (p: GalleryPhoto | undefined) => (p ? p.key || p.mediaId || p.streamUid || undefined : undefined);
  const [view, setView] = useState<{ index: number | null; key?: string | undefined }>({ index, key: index === null ? undefined : idOf(photos[index]) });
  const [openedAt, setOpenedAt] = useState(index);
  if (index !== openedAt) { setOpenedAt(index); setView({ index, key: index === null ? undefined : idOf(photos[index]) }); }
  // The list can change while open (a photo deleted, or moved): stay on the same photo by its key, or on its neighbour.
  let shown: number | null = null;
  if (view.index !== null && photos.length > 0) {
    const moved = view.key !== undefined && idOf(photos[view.index]) !== view.key ? photos.findIndex((p) => idOf(p) === view.key) : -1;
    shown = Math.min(moved >= 0 ? moved : view.index, photos.length - 1);
  }
  const shownKey = shown === null ? undefined : idOf(photos[shown]);
  useEffect(() => {
    if (shown !== null && (view.index !== shown || view.key !== shownKey)) setView({ index: shown, key: shownKey });
    if (index !== null && photos.length === 0) onClose();
  });
  const viewed = shown !== null ? photos[shown] : undefined;
  // Seven controls do not fit one line at phone width: wrap them, with 44px targets (the wide toolbar is untouched).
  const compact = useMaxWidth(480);
  const kind = viewed ? resolveMediaType(viewed) : "photo";

  const toolbar = viewed
    ? [
        <MediaViewerToolbar
          key="tb"
          kind={kind}
          provider={viewed.provider}
          edited={!!viewed.annotated}
          hide={typeof hideActions === "function" ? hideActions(viewed) : hideActions}
          isCover={!!coverKey && viewed.key === coverKey}
          compact={compact}
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
  /**
   * An entry whose blob is on ANOTHER device. `usePhotoOps` gives it an empty
   * `url` on purpose — there is no local blob and no stored key to fall back on
   * — so handing it to the lightbox as a `src` produced the one slide that
   * rendered a broken-image glyph, and a photo that has not arrived looked
   * exactly like a photo that failed.
   *
   * Keyed on `pendingPlaceholder`, never on `pending`: an entry uploading from
   * THIS device has a local blob and must still be shown.
   */
  type PlaceholderSlide = { type: "placeholder"; alt: string };
  const slides = photos.map((p) => {
    if (resolveMediaType(p) === "video") {
      return {
        type: "video" as const,
        provider: p.provider ?? "stream",
        streamUid: p.streamUid,
        mediaId: p.mediaId,
        alt: p.label,
      } as VideoSlide;
    }
    if (p.pendingPlaceholder) {
      return { type: "placeholder" as const, alt: p.label } as PlaceholderSlide;
    }
    return { src: fullResUrl(p.url), alt: p.label };
  });

  return (
    <PhotoLightbox
      slides={slides}
      index={shown ?? 0}
      open={shown !== null}
      onClose={onClose}
      onView={(next) => setView({ index: next, key: photos[next]?.key })}
      toolbarButtons={toolbar}
      toolbarWrap={compact}
      renderSlide={(slide) => {
        const ps = slide as PlaceholderSlide | undefined;
        if (ps?.type === "placeholder") {
          return (
            <div
              data-testid="media-pending-placeholder"
              className="flex h-full w-full items-center justify-center p-8 text-center text-sm text-ih-fg-3"
            >
              {m.media_viewer_pending_placeholder()}
            </div>
          );
        }
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
