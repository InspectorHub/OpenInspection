/**
 * <ReportMediaTile> — renders one report media cell (photo OR video).
 *
 * Extracted from <ReportView>'s former inline `renderMediaTile` closure. The
 * behavior is byte-identical; the three closure dependencies (printMode,
 * lightbox opener, failed-photo marker) are now explicit props.
 *
 * Plan 7 — when the server resolved a video kind, branch: web report → lazy
 * Stream <iframe> at a fixed 16/9 aspect (no CLS); PDF render path → poster
 * <img> + QR + "Watch the walk-through" link. Photo / legacy / no-subdomain
 * fall through to the existing <img> with its onError/aspect-[4/3]/alt
 * hardening intact.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { photoDisplayName, withDownload } from "~/lib/photo-name";
import { m } from "~/paraglide/messages";
import { qrToSvg } from "../../../../../server/lib/qr";
import { PRINT_FIGURE_CLASS, printThumbWidth, type ReportPhoto } from "./types";

export interface ReportMediaTileProps {
  photo: ReportPhoto;
  alt: string;
  idx: number;
  printMode: boolean;
  onOpenLightbox: (url: string) => void;
  onPhotoFailed: (key: string) => void;
}

export function ReportMediaTile({ photo, alt, idx, printMode, onOpenLightbox, onPhotoFailed }: ReportMediaTileProps) {
  const media = photo.media;
  const name = photoDisplayName(photo.key);

  if (media && media.kind === "video-player") {
    return (
      <div key={`v-${media.streamUid}-${idx}`} className={`relative aspect-video overflow-hidden rounded ${PRINT_FIGURE_CLASS}`}>
        <iframe
          src={media.playerSrc}
          title={alt}
          loading="lazy"
          allow="accelerated-2d-canvas; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  }

  if (media && media.kind === "video-poster") {
    // PDF cannot embed a player → poster frame + QR + deep link.
    const qr = qrToSvg(media.playerLinkUrl);
    return (
      <div key={`vp-${media.streamUid}-${idx}`} className={`relative aspect-video overflow-hidden rounded ${PRINT_FIGURE_CLASS}`}>
        <img src={media.posterUrl} alt={alt} title={name} className="h-full w-full object-cover" loading="eager" />
        <span
          className="absolute bottom-1 right-1 h-12 w-12 rounded bg-ih-bg-card p-0.5"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: server-generated SVG from qrToSvg — no user input
          dangerouslySetInnerHTML={{ __html: qr }}
          aria-hidden="true"
        />
        <a
          href={media.playerLinkUrl}
          /* ds-allow: customer report render surface, not app chrome — fixed-dark caption chip over media */
          className="absolute inset-x-0 bottom-0 bg-[rgba(15,23,42,0.55)] px-1.5 py-0.5 text-[10px] font-semibold text-white"
        >
          {m.pca_media_watch_walkthrough()}
        </a>
      </div>
    );
  }

  if (media && media.kind === "r2-video-player") {
    // Web report → native <video> with the R2 poster + clip URL. The clip route
    // is tenant-guarded by the pool-row lookup; preload="none" so the poster
    // shows first and the clip only downloads on play (no CLS, no eager bytes).
    return (
      <div key={`r2v-${media.mediaId}-${idx}`} className={`relative aspect-video overflow-hidden rounded ${PRINT_FIGURE_CLASS}`}>
        <video
          src={media.playerSrc}
          poster={media.posterUrl}
          controls
          preload="none"
          title={alt}
          className="absolute inset-0 h-full w-full bg-ih-bg-muted object-cover"
        />
      </div>
    );
  }

  if (media && media.kind === "r2-video-poster") {
    // PDF cannot embed a player → poster frame only. R2 clips have no public
    // deep-link watch page (unlike Stream), so the poster JPEG is the static
    // fallback with no QR/link.
    return (
      <div key={`r2vp-${media.mediaId}-${idx}`} className={`relative aspect-video overflow-hidden rounded ${PRINT_FIGURE_CLASS}`}>
        <img src={media.posterUrl} alt={alt} title={name} className="h-full w-full object-cover" loading="eager" />
      </div>
    );
  }

  // Image branch (photo / legacy / fail-closed video) — unchanged hardening.
  return (
    <div key={photo.key} className={`group relative aspect-[4/3] overflow-hidden rounded ${PRINT_FIGURE_CLASS}`}>
      <img
        src={`${photo.url}&w=${printThumbWidth(printMode)}`}
        alt={alt}
        title={name}
        className="w-full h-full object-cover cursor-pointer"
        loading={printMode ? "eager" : "lazy"}
        onClick={() => onOpenLightbox(photo.url)}
        onError={() => onPhotoFailed(photo.key)}
      />
      <a
        href={withDownload(photo.url)}
        download={name}
        title={m.pca_media_download_title({ name })}
        onClick={(e) => e.stopPropagation()}
        /* ds-allow: customer report render surface, not app chrome — fixed-dark download chip over media */
        className="absolute top-1 right-1 rounded bg-[rgba(15,23,42,0.55)] px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
      >
        ↓
      </a>
    </div>
  );
}
