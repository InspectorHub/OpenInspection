// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
    clearServiceWorkerUserCache,
    isPublicPage,
    shouldSyncOnNavigation,
    syncServiceWorkerUser,
    type SWMessagingLike,
} from './sw-user-cache';

function container() {
    const postMessage = vi.fn();
    const listeners: Array<() => void> = [];
    const c: SWMessagingLike = {
        controller: { postMessage },
        addEventListener: (_t: 'controllerchange', fn: () => void) => { listeners.push(fn); },
        removeEventListener: () => undefined,
    };
    return { c, postMessage, listeners };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('clearServiceWorkerUserCache', () => {
    it('tells the controlling worker to drop the signed-in user\'s cache', () => {
        const { c, postMessage } = container();
        expect(clearServiceWorkerUserCache(c)).toBe(true);
        expect(postMessage).toHaveBeenCalledWith({ type: 'clear-user-cache' });
    });

    it('is a quiet no-op without service worker support or a controller', () => {
        expect(clearServiceWorkerUserCache(undefined)).toBe(false);
        expect(clearServiceWorkerUserCache({ controller: null })).toBe(false);
        expect(clearServiceWorkerUserCache({
            controller: { postMessage: () => { throw new Error('closed'); } },
        })).toBe(false);
    });
});

describe('syncServiceWorkerUser', () => {
    it('sends the marker of the signed-in user', async () => {
        const { c, postMessage } = container();
        const f = vi.fn(async () => json({ data: { user: { sessionMarker: 'abc123' } } }));
        await syncServiceWorkerUser(c, f as unknown as typeof fetch);
        expect(f).toHaveBeenCalledWith('/api/session/context', expect.objectContaining({ credentials: 'same-origin' }));
        expect(postMessage).toHaveBeenCalledWith({ type: 'set-user', marker: 'abc123' });
    });

    it('sends null when nobody is signed in (401)', async () => {
        const { c, postMessage } = container();
        await syncServiceWorkerUser(c, (async () => json({}, 401)) as unknown as typeof fetch);
        expect(postMessage).toHaveBeenCalledWith({ type: 'set-user', marker: null });
    });

    it('says nothing when the answer is unknown (offline, server error, no marker)', async () => {
        for (const f of [
            async () => { throw new TypeError('offline'); },
            async () => json({}, 500),
            async () => json({ data: { user: {} } }),
        ]) {
            const { c, postMessage } = container();
            await syncServiceWorkerUser(c, f as unknown as typeof fetch);
            expect(postMessage).not.toHaveBeenCalled();
        }
    });

    it('does not even ask when there is no worker to tell', async () => {
        const f = vi.fn();
        await syncServiceWorkerUser(undefined, f as unknown as typeof fetch);
        await syncServiceWorkerUser({ controller: null }, f as unknown as typeof fetch);
        expect(f).not.toHaveBeenCalled();
    });
});

describe('shouldSyncOnNavigation', () => {
    it('syncs when a sign-in, sign-out or invite page is left or entered', () => {
        expect(shouldSyncOnNavigation('/login', '/inspections')).toBe(true);
        expect(shouldSyncOnNavigation('/join', '/login')).toBe(true);
        expect(shouldSyncOnNavigation('/inspections', '/logout')).toBe(true);
        expect(shouldSyncOnNavigation('/agent-login', '/agent-portal')).toBe(true);
    });
    it('does not sync on ordinary navigation', () => {
        expect(shouldSyncOnNavigation('/inspections', '/calendar')).toBe(false);
        expect(shouldSyncOnNavigation('/inspections/abc/edit', '/inspections')).toBe(false);
    });
});

describe('isPublicPage', () => {
    it('knows the pages that are not a staff session', () => {
        expect(isPublicPage('/report/acme/abc')).toBe(true);
        expect(isPublicPage('/portal/acme')).toBe(true);
        expect(isPublicPage('/inspections')).toBe(false);
        expect(isPublicPage('/inspections/x/edit')).toBe(false);
        expect(isPublicPage('/login')).toBe(false);
    });
});
