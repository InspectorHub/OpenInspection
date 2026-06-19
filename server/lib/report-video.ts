/**
 * Plan 7 — report media-branch selector.
 *
 * Pure function deciding how one report media entry renders. Photos render as an
 * `<img>`. Videos render as a Cloudflare Stream player on the web, but the PDF
 * render chain (`env.BROWSER.quickAction('pdf')`) is a headless browser that
 * CANNOT embed video — so on the PDF path a video degrades to a Stream poster
 * image + a QR/link to the online player.
 *
 * Fail-closed: if a "video" entry lacks a `streamUid`, or the account's Stream
 * customer subdomain is missing (so no Stream URL can be built), the entry
 * degrades to the image branch. This function NEVER throws and NEVER fabricates
 * a subdomain — the caller decides what the image `url` should be.
 *
 * No env access, no fetch — all inputs are plain values. Stream poster URLs are
 * public because uploads set `requireSignedURLs: false` (Task 4).
 */

export interface ReportMediaEntry {
    key: string;
    mediaType?: 'photo' | 'video' | undefined;
    streamUid?: string | undefined;
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
      };

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
    const isVideo = entry.mediaType === 'video' && !!entry.streamUid && !!ctx.streamCustomerSubdomain;

    // Photo, legacy entry, or a video we cannot build Stream URLs for → image.
    if (!isVideo) {
        return { kind: 'image', src: entry.url, key: entry.key };
    }

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
