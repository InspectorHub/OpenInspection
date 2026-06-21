/**
 * Plan 7 — report media-branch selector.
 *
 * Pure function deciding how one report media entry renders. Photos render as an
 * `<img>`. Videos render as a Cloudflare Stream player on the web, but the PDF
 * render chain (`env.BROWSER.quickAction('pdf')`) is a headless browser that
 * CANNOT embed video — so on the PDF path a video degrades to a Stream poster
 * image + a QR/link to the online player.
 *
 * R2 videos (provider='r2', no streamUid): on the web path they render as a
 * native `<video>` player (poster from `/r2-object/:mediaId/poster`, clip from
 * `/r2-object/:mediaId`). On the PDF path they degrade to the poster JPEG only
 * (same principle as Stream — PDF cannot play video).
 *
 * Fail-closed: if a video entry cannot yield a renderable URL (missing mediaId
 * for R2, or missing streamUid/subdomain for Stream), the entry degrades to the
 * image branch. This function NEVER throws and NEVER fabricates URLs — the
 * caller decides what the image `url` should be.
 *
 * No env access, no fetch — all inputs are plain values. Stream poster URLs are
 * public because uploads set `requireSignedURLs: false` (Task 4).
 */

export interface ReportMediaEntry {
    key: string;
    mediaType?: 'photo' | 'video' | undefined;
    /** Video backend provider ('stream' = Cloudflare Stream, 'r2' = R2 bucket). */
    provider?: 'stream' | 'r2' | undefined;
    streamUid?: string | undefined;
    /** Pool row id — required for R2 video URLs. */
    mediaId?: string | undefined;
    /** R2 poster key — present when a poster was uploaded (R2 videos). */
    posterKey?: string | undefined;
    posterPct?: number | undefined;
    durationSec?: number | undefined;
    /** Pre-resolved image URL (cropped/annotated/key cascade already applied by getReportData). */
    url: string;
}

export interface ReportMediaContext {
    /** True on the render-token / PDF path → video falls back to poster + QR. */
    isPdf: boolean;
    /** Cloudflare Stream customer subdomain (from env). Empty ⇒ no Stream URLs. */
    streamCustomerSubdomain: string;
    /** App base URL for the player deep link in the PDF QR/link. */
    appBaseUrl: string;
    /**
     * Base URL prefix for R2 serve routes (e.g. `/api/inspections/{id}`).
     * Required to build r2-object URLs for R2 videos. If absent, R2 videos
     * degrade to the image branch.
     */
    r2BaseUrl?: string | undefined;
}

export type ReportMedia =
    | { kind: 'image'; src: string; key: string }
    | { kind: 'video-player'; streamUid: string; posterUrl: string; playerSrc: string; durationSec?: number | undefined }
    | {
          kind: 'video-poster';
          streamUid: string;
          posterUrl: string;
          playerLinkUrl: string;
          durationSec?: number | undefined;
          qr: true;
      }
    /** R2 video — native player (web path). posterUrl links to the poster JPEG; playerSrc is the clip URL. */
    | { kind: 'r2-video-player'; mediaId: string; posterUrl: string; playerSrc: string; durationSec?: number | undefined }
    /** R2 video — poster only (PDF path). posterUrl links to the poster JPEG. */
    | { kind: 'r2-video-poster'; mediaId: string; posterUrl: string; durationSec?: number | undefined };

function posterTimeSec(entry: ReportMediaEntry): number {
    const pct = typeof entry.posterPct === 'number' ? entry.posterPct : 0;
    const dur = typeof entry.durationSec === 'number' ? entry.durationSec : 0;
    if (!(dur > 0)) return 0;
    const clamped = pct < 0 ? 0 : pct > 1 ? 1 : pct;
    return Math.round(clamped * dur);
}

function streamPosterUrl(sub: string, uid: string, sec: number): string {
    return `https://${sub}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?time=${sec}s`;
}

export function selectReportMedia(entry: ReportMediaEntry, ctx: ReportMediaContext): ReportMedia {
    const isStreamVideo = entry.mediaType === 'video'
        && entry.provider !== 'r2'
        && !!entry.streamUid
        && !!ctx.streamCustomerSubdomain;

    const isR2Video = entry.mediaType === 'video'
        && (entry.provider === 'r2' || (!entry.streamUid && !!entry.mediaId))
        && !!entry.mediaId
        && !!ctx.r2BaseUrl;

    // Stream video branch.
    if (isStreamVideo) {
        const sub = ctx.streamCustomerSubdomain;
        const uid = entry.streamUid!;
        const posterUrl = streamPosterUrl(sub, uid, posterTimeSec(entry));

        if (ctx.isPdf) {
            return {
                kind: 'video-poster',
                streamUid: uid,
                posterUrl,
                playerLinkUrl: `${ctx.appBaseUrl}/watch/${uid}`,
                durationSec: entry.durationSec,
                qr: true,
            };
        }

        return {
            kind: 'video-player',
            streamUid: uid,
            posterUrl,
            playerSrc: `https://${sub}.cloudflarestream.com/${uid}/iframe`,
            durationSec: entry.durationSec,
        };
    }

    // R2 video branch.
    if (isR2Video) {
        const mediaId = entry.mediaId!;
        const base = ctx.r2BaseUrl!;
        const posterUrl = `${base}/r2-object/${encodeURIComponent(mediaId)}/poster`;
        const playerSrc = `${base}/r2-object/${encodeURIComponent(mediaId)}`;

        if (ctx.isPdf) {
            // PDF cannot play video — degrade to poster JPEG only.
            return {
                kind: 'r2-video-poster',
                mediaId,
                posterUrl,
                durationSec: entry.durationSec,
            };
        }

        return {
            kind: 'r2-video-player',
            mediaId,
            posterUrl,
            playerSrc,
            durationSec: entry.durationSec,
        };
    }

    // Photo, legacy entry, or a video we cannot build URLs for → image.
    return { kind: 'image', src: entry.url, key: entry.key };
}
