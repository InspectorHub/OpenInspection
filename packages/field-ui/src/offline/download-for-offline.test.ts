/**
 * #476 — the page side of "Download for offline": which photo keys an
 * inspection carries, what the service worker's per-user cache already
 * holds, and the MessageChannel round-trip that asks the worker to fetch
 * the rest now.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
    collectPhotoKeys,
    coreOfflineUrls,
    downloadForOffline,
    offlineCopyStatus,
} from './download-for-offline';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('collectPhotoKeys', () => {
    it('collects item and defect photo keys, deduped across the dual-keyed map', () => {
        const results = {
            '_default:s1:i1': {
                photos: [{ key: 'a.jpg' }, { key: '' }, { key: 'b.jpg' }],
                tabs: { defects: [{ cannedId: 'c1', photos: [{ key: 'c.jpg' }] }] },
                customComments: { defects: [{ id: 'x1', photos: [{ key: 'a.jpg' }] }] },
            },
            i1: {
                photos: [{ key: 'a.jpg' }],
            },
        };
        expect(collectPhotoKeys(results).sort()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    });

    it('ignores entries with no photos at all', () => {
        expect(collectPhotoKeys({ '_default:s1:i1': { rating: 'good' } })).toEqual([]);
    });
});

describe('offlineCopyStatus', () => {
    function stubCaches(stored: string[]) {
        const set = new Set(stored);
        vi.stubGlobal('caches', {
            keys: async () => ['openinspection-user-v4-a1'],
            open: async () => ({
                match: async (url: string) => (set.has(url) ? ({}) as Response : undefined),
            }),
        });
    }

    it('is cached only when the editor page, inspection and results are all stored', async () => {
        const id = 'insp-1';
        stubCaches([...coreOfflineUrls(id), '/api/inspections/insp-1/photo?key=a.jpg']);
        const status = await offlineCopyStatus(id, ['/api/inspections/insp-1/photo?key=a.jpg', '/api/inspections/insp-1/photo?key=b.jpg']);
        expect(status).toEqual({ supported: true, inspectionCached: true, photosCached: 1, photosTotal: 2 });
    });

    it('is not cached when any core URL is missing', async () => {
        stubCaches(['/api/inspections/insp-1', '/api/inspections/insp-1/results']);
        const status = await offlineCopyStatus('insp-1', []);
        expect(status.inspectionCached).toBe(false);
    });

    it('reports unsupported with nothing cached when the Cache API is absent', async () => {
        vi.stubGlobal('caches', undefined);
        const status = await offlineCopyStatus('insp-1', ['/x']);
        expect(status).toEqual({ supported: false, inspectionCached: false, photosCached: 0, photosTotal: 1 });
    });
});

describe('downloadForOffline', () => {
    it('posts the inspection id and URLs to the controlling worker and resolves with its reply', async () => {
        const posted: Array<{ message: unknown; ports: unknown[] }> = [];
        const controller = {
            postMessage(message: unknown, ports: unknown[]) {
                posted.push({ message, ports });
                // The worker replies on the transferred port.
                (ports[0] as MessagePort).postMessage({ type: 'download-inspection-result', id: 'insp-1', ok: true, cached: 3, total: 3 });
            },
        };
        vi.stubGlobal('navigator', { serviceWorker: { controller } });
        const result = await downloadForOffline('insp-1', ['/a', '/b', '/c']);
        expect(posted).toHaveLength(1);
        expect(posted[0].message).toEqual({ type: 'download-inspection', id: 'insp-1', urls: ['/a', '/b', '/c'] });
        expect(result).toEqual({ ok: true, cached: 3, total: 3 });
    });

    it('fails closed with no controlling service worker', async () => {
        vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
        const result = await downloadForOffline('insp-1', ['/a']);
        expect(result).toEqual({ ok: false, cached: 0, total: 1, reason: 'no-service-worker' });
    });
});
