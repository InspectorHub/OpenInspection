import { describe, it, expect } from 'vitest';
import { selectReportMedia } from '../../server/lib/report-video';

const ctx = {
    isPdf: false,
    streamCustomerSubdomain: 'customer-abc',
    appBaseUrl: 'https://app.example.com',
};

describe('selectReportMedia — photo entries', () => {
    it('non-pdf photo resolves to an image carrying the pre-resolved displayKey + url', () => {
        // getReportData already collapses the cropped/annotated/key cascade into
        // `key` (displayKey) + `url`; the selector echoes them on the image branch.
        expect(
            selectReportMedia({ key: 'anno.png', url: '/p?key=anno.png' }, ctx),
        ).toEqual({ kind: 'image', src: '/p?key=anno.png', key: 'anno.png' });
    });

    it('a legacy entry with no mediaType is treated as an image (never throws)', () => {
        expect(selectReportMedia({ key: 'a/b.jpg', url: '/p?key=a/b.jpg' }, ctx)).toEqual({
            kind: 'image',
            src: '/p?key=a/b.jpg',
            key: 'a/b.jpg',
        });
    });

    it('a photo entry stays an image even on the pdf path', () => {
        const r = selectReportMedia({ key: 'a/b.jpg', url: '/p?key=a/b.jpg' }, { ...ctx, isPdf: true });
        expect(r.kind).toBe('image');
    });
});

describe('selectReportMedia — video entries (web)', () => {
    it('non-pdf video resolves to a Stream player with a poster + iframe src', () => {
        const r = selectReportMedia(
            { key: '', mediaType: 'video', streamUid: 'uid123', posterPct: 0.5, durationSec: 12, url: '' },
            ctx,
        );
        expect(r).toEqual({
            kind: 'video-player',
            streamUid: 'uid123',
            posterUrl: 'https://customer-abc.cloudflarestream.com/uid123/thumbnails/thumbnail.jpg?time=6s',
            playerSrc: 'https://customer-abc.cloudflarestream.com/uid123/iframe',
            durationSec: 12,
        });
    });

    it('poster time is 0s when posterPct/duration are absent', () => {
        const r = selectReportMedia({ key: '', mediaType: 'video', streamUid: 'u', url: '' }, ctx);
        if (r.kind !== 'video-player') throw new Error('expected video-player');
        expect(r.posterUrl).toContain('thumbnail.jpg?time=0s');
    });
});

describe('selectReportMedia — video entries (pdf)', () => {
    it('pdf video resolves to a poster image + QR/link (cannot embed video)', () => {
        const r = selectReportMedia(
            { key: '', mediaType: 'video', streamUid: 'uid123', posterPct: 0.25, durationSec: 20, url: '' },
            { ...ctx, isPdf: true },
        );
        expect(r).toEqual({
            kind: 'video-poster',
            streamUid: 'uid123',
            posterUrl: 'https://customer-abc.cloudflarestream.com/uid123/thumbnails/thumbnail.jpg?time=5s',
            playerLinkUrl: 'https://app.example.com/watch/uid123',
            durationSec: 20,
            qr: true,
        });
    });
});

describe('selectReportMedia — graceful fail-closed (no subdomain)', () => {
    it('a video with no subdomain falls back to an image branch and never throws', () => {
        const r = selectReportMedia(
            { key: '', mediaType: 'video', streamUid: 'uid', url: '/poster-fallback' },
            { ...ctx, streamCustomerSubdomain: '' },
        );
        // no Stream URLs possible — degrade to a (likely empty) image, never throw
        expect(r.kind).toBe('image');
    });

    it('a video with no streamUid degrades to an image branch', () => {
        const r = selectReportMedia({ key: 'x', mediaType: 'video', url: '/x' }, ctx);
        expect(r.kind).toBe('image');
    });
});
