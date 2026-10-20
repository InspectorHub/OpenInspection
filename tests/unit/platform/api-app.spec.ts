import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InProcessApp } from '../../../server/lib/api-app';

// The registry is module state, so each test starts from a freshly evaluated module.
async function freshRegistry() {
    vi.resetModules();
    return import('../../../server/lib/api-app');
}

const fakeApp = (tag: string): InProcessApp => ({
    fetch: async () => new Response(tag),
    getOpenAPIDocument: () => ({ tag }),
});

describe('api-app registry', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('rejects with a clear message when no loader was registered', async () => {
        const { getApiApp } = await freshRegistry();
        await expect(getApiApp()).rejects.toThrow(/loader is not registered/);
    });

    it('returns whatever the registered loader resolves to (positive control for the rejection above)', async () => {
        const { getApiApp, registerApiAppLoader } = await freshRegistry();
        const app = fakeApp('a');
        registerApiAppLoader(async () => app);
        await expect(getApiApp()).resolves.toBe(app);
    });

    it('does not run the loader at registration time, only when the app is requested', async () => {
        const { getApiApp, registerApiAppLoader } = await freshRegistry();
        const loader = vi.fn(async () => fakeApp('lazy'));
        registerApiAppLoader(loader);
        expect(loader).not.toHaveBeenCalled();
        await getApiApp();
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('does not cache: every call goes to the loader, which owns any caching', async () => {
        const { getApiApp, registerApiAppLoader } = await freshRegistry();
        const loader = vi.fn(async () => fakeApp('x'));
        registerApiAppLoader(loader);
        await getApiApp();
        await getApiApp();
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('a second registration replaces the first', async () => {
        const { getApiApp, registerApiAppLoader } = await freshRegistry();
        const first = fakeApp('first');
        const second = fakeApp('second');
        registerApiAppLoader(async () => first);
        registerApiAppLoader(async () => second);
        await expect(getApiApp()).resolves.toBe(second);
    });

    it('propagates a loader failure to the caller, and recovers once the loader succeeds', async () => {
        const { getApiApp, registerApiAppLoader } = await freshRegistry();
        const app = fakeApp('ok');
        let fail = true;
        registerApiAppLoader(async () => {
            if (fail) throw new Error('graph failed to evaluate');
            return app;
        });
        await expect(getApiApp()).rejects.toThrow('graph failed to evaluate');
        fail = false;
        await expect(getApiApp()).resolves.toBe(app);
    });

    it('turns a loader that throws synchronously into a rejection', async () => {
        const { getApiApp, registerApiAppLoader } = await freshRegistry();
        registerApiAppLoader(() => {
            throw new Error('sync failure');
        });
        await expect(getApiApp()).rejects.toThrow('sync failure');
    });
});
