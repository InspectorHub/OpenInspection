import { describe, it, expect } from 'vitest';
import { selectReportMedia } from '../../../server/lib/report-video';

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

describe('selectReportMedia — R2 video entries', () => {
    const r2ctx = { ...ctx, r2BaseUrl: '/api/inspections/insp1/media/video' };

    it('web: provider=r2 resolves to a native player (poster + clip URL), NOT dropped', () => {
        const r = selectReportMedia(
            { key: 'v', mediaType: 'video', provider: 'r2', mediaId: 'm1', posterKey: 'p/k', durationSec: 8, url: '' },
            r2ctx,
        );
        expect(r).toEqual({
            kind: 'r2-video-player',
            mediaId: 'm1',
            posterUrl: '/api/inspections/insp1/media/video/r2-object/m1/poster',
            playerSrc: '/api/inspections/insp1/media/video/r2-object/m1',
            durationSec: 8,
        });
    });

    it('pdf: provider=r2 degrades to a poster image only (cannot embed video)', () => {
        const r = selectReportMedia(
            { key: 'v', mediaType: 'video', provider: 'r2', mediaId: 'm1', posterKey: 'p/k', durationSec: 8, url: '' },
            { ...r2ctx, isPdf: true },
        );
        expect(r).toEqual({
            kind: 'r2-video-poster',
            mediaId: 'm1',
            posterUrl: '/api/inspections/insp1/media/video/r2-object/m1/poster',
            durationSec: 8,
        });
    });

    it('a streamUid-less video with a mediaId is inferred as R2 (no explicit provider)', () => {
        const r = selectReportMedia(
            { key: 'v', mediaType: 'video', mediaId: 'm2', url: '' },
            r2ctx,
        );
        expect(r.kind).toBe('r2-video-player');
    });

    it('provider=r2 with NO r2BaseUrl fails closed to an image (never throws, never fabricates)', () => {
        const r = selectReportMedia(
            { key: 'v', mediaType: 'video', provider: 'r2', mediaId: 'm1', url: '/fallback' },
            ctx, // no r2BaseUrl
        );
        expect(r.kind).toBe('image');
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

describe('selectReportMedia — proof on the R2 serve URLs', () => {
    const r2 = { ...ctx, r2BaseUrl: '/api/public/report/acme/insp1/video' };
    const entry = { key: 'k', mediaType: 'video' as const, provider: 'r2' as const, mediaId: 'm 1', posterKey: 'p/k', url: '' };

    it('appends the proof to the clip and the poster URL, and leaves them bare when there is none', () => {
        const withProof = selectReportMedia(entry, { ...r2, r2Query: 'token=abc' });
        expect(withProof).toMatchObject({
            kind: 'r2-video-player',
            playerSrc: '/api/public/report/acme/insp1/video/r2-object/m%201?token=abc',
            posterUrl: '/api/public/report/acme/insp1/video/r2-object/m%201/poster?token=abc',
        });
        const bare = selectReportMedia(entry, r2);
        expect(bare).toMatchObject({ playerSrc: '/api/public/report/acme/insp1/video/r2-object/m%201' });
        expect(selectReportMedia(entry, { ...r2, r2Query: '' })).toMatchObject({ playerSrc: '/api/public/report/acme/insp1/video/r2-object/m%201' });
    });

    it('the PDF path states the poster with the proof too', () => {
        expect(selectReportMedia(entry, { ...r2, isPdf: true, r2Query: 'render=t' })).toMatchObject({
            kind: 'r2-video-poster', posterUrl: '/api/public/report/acme/insp1/video/r2-object/m%201/poster?render=t',
        });
    });
});

describe('selectReportMedia - R2 video without a poster', () => {
    const r2ctx = { ...ctx, r2BaseUrl: '/api/inspections/insp1/media/video' };
    const noPoster = { key: 'v', mediaType: 'video' as const, provider: 'r2' as const, mediaId: 'm1', durationSec: 8, url: '' };

    it('web: still a player, but names no poster (the poster route would answer 404)', () => {
        const r = selectReportMedia(noPoster, r2ctx);
        expect(r).toEqual({
            kind: 'r2-video-player',
            mediaId: 'm1',
            playerSrc: '/api/inspections/insp1/media/video/r2-object/m1',
            durationSec: 8,
        });
        expect('posterUrl' in r).toBe(false);
    });

    it('pdf: nothing to print without a poster, so it falls back to the image branch instead of a poster URL that 404s', () => {
        const r = selectReportMedia(noPoster, { ...r2ctx, isPdf: true });
        expect(r.kind).toBe('image');
    });

    it('control: with a poster key both paths still name the poster', () => {
        expect(selectReportMedia({ ...noPoster, posterKey: 'p/k' }, r2ctx)).toMatchObject({ kind: 'r2-video-player', posterUrl: expect.stringContaining('/poster') });
        expect(selectReportMedia({ ...noPoster, posterKey: 'p/k' }, { ...r2ctx, isPdf: true }).kind).toBe('r2-video-poster');
    });
});
