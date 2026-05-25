// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

// Use dynamic import inside tests so fake-indexeddb is in place before db.js opens.

describe('prefetch.js', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(async () => {
        originalFetch = globalThis.fetch;
        // Reset Dexie state between tests
        const dbMod = await import('../../public/js/db.js');
        try { await dbMod.db.delete(); } catch { /* not yet open */ }
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('caches inspections from /full payload into Dexie', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { needsAttention: [{ id: 'i1' }], today: [], thisWeek: [] } }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { inspection: { id: 'i1', propertyAddress: 'X' }, template: null, results: null, base: null } }) });

        const { startPrefetch, stopPrefetch } = await import('../../public/js/prefetch.js');
        await startPrefetch();
        stopPrefetch();

        const { db } = await import('../../public/js/db.js');
        const cached = await db.inspections.get('i1');
        expect(cached).toBeTruthy();
        expect(cached?.propertyAddress).toBe('X');
    });

    it('skips fetch when offline', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        const fetchSpy = vi.fn();
        globalThis.fetch = fetchSpy;

        const { startPrefetch, stopPrefetch } = await import('../../public/js/prefetch.js');
        await startPrefetch();
        stopPrefetch();

        expect(fetchSpy).not.toHaveBeenCalled();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });
});
