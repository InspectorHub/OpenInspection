import { describe, it, expect, vi, beforeEach } from 'vitest';
import { swKillSwitchActive, bootstrapServiceWorker } from '~/lib/offline/sw-bootstrap';
import type { SWRegistrarLike } from '~/lib/offline/sw-bootstrap';

// ── swKillSwitchActive ────────────────────────────────────────────────────────

describe('swKillSwitchActive', () => {
    const noStorage: Pick<Storage, 'getItem'> = { getItem: () => null };

    it('returns true when ?no-sw=1 is present in the query string', () => {
        expect(swKillSwitchActive('?no-sw=1', noStorage)).toBe(true);
    });

    it('returns true when localStorage oi:sw-disable === "1"', () => {
        const storage: Pick<Storage, 'getItem'> = { getItem: (k) => (k === 'oi:sw-disable' ? '1' : null) };
        expect(swKillSwitchActive('', storage)).toBe(true);
    });

    it('returns false when neither flag is set', () => {
        expect(swKillSwitchActive('?foo=bar', noStorage)).toBe(false);
    });

    it('returns false when no-sw has a value other than "1"', () => {
        expect(swKillSwitchActive('?no-sw=0', noStorage)).toBe(false);
    });

    it('returns false when localStorage oi:sw-disable is "0"', () => {
        const storage: Pick<Storage, 'getItem'> = { getItem: (k) => (k === 'oi:sw-disable' ? '0' : null) };
        expect(swKillSwitchActive('', storage)).toBe(false);
    });

    it('returns false when localStorage throws (quota / private browsing)', () => {
        const storage: Pick<Storage, 'getItem'> = {
            getItem: () => { throw new Error('SecurityError'); },
        };
        expect(swKillSwitchActive('', storage)).toBe(false);
    });
});

// ── bootstrapServiceWorker ────────────────────────────────────────────────────

describe('bootstrapServiceWorker', () => {
    const noStorage: Pick<Storage, 'getItem'> = { getItem: () => null };

    function makeContainer(
        opts: { registerResult?: unknown; registerThrows?: boolean } = {},
    ): SWRegistrarLike & { registerCalls: string[]; getRegistrationsCalls: number } {
        const spy = {
            registerCalls: [] as string[],
            getRegistrationsCalls: 0,
            async getRegistrations() {
                spy.getRegistrationsCalls++;
                return [];
            },
            async register(url: string) {
                spy.registerCalls.push(url);
                if (opts.registerThrows) throw new Error('SW registration failed');
                return opts.registerResult ?? {};
            },
        };
        return spy;
    }

    it('returns "unavailable" when container is undefined', async () => {
        const result = await bootstrapServiceWorker(undefined, '', noStorage);
        expect(result).toBe('unavailable');
    });

    it('calls register("/sw.js") and returns "registered" on a normal boot', async () => {
        const container = makeContainer();
        const result = await bootstrapServiceWorker(container, '', noStorage);
        expect(result).toBe('registered');
        expect(container.registerCalls).toEqual(['/sw.js']);
    });

    it('calls unregisterAllServiceWorkers and returns "disabled" when kill switch is on via query', async () => {
        const container = makeContainer();
        const result = await bootstrapServiceWorker(container, '?no-sw=1', noStorage);
        expect(result).toBe('disabled');
        // register must NOT have been called
        expect(container.registerCalls).toHaveLength(0);
        // getRegistrations must have been called (unregister path)
        expect(container.getRegistrationsCalls).toBeGreaterThan(0);
    });

    it('calls unregisterAllServiceWorkers and returns "disabled" when kill switch is on via localStorage', async () => {
        const storage: Pick<Storage, 'getItem'> = { getItem: (k) => (k === 'oi:sw-disable' ? '1' : null) };
        const container = makeContainer();
        const result = await bootstrapServiceWorker(container, '', storage);
        expect(result).toBe('disabled');
        expect(container.registerCalls).toHaveLength(0);
        expect(container.getRegistrationsCalls).toBeGreaterThan(0);
    });

    it('returns "unavailable" when register() throws — never propagates', async () => {
        const container = makeContainer({ registerThrows: true });
        // Must not throw, must resolve to 'unavailable'
        await expect(bootstrapServiceWorker(container, '', noStorage)).resolves.toBe('unavailable');
    });

    it('does not call register when kill switch is active via query string', async () => {
        const container = makeContainer();
        await bootstrapServiceWorker(container, '?no-sw=1&other=x', noStorage);
        expect(container.registerCalls).toHaveLength(0);
    });

    it('returns "registered" when localStorage kill switch is absent even if key exists with other value', async () => {
        const storage: Pick<Storage, 'getItem'> = { getItem: (k) => (k === 'oi:sw-disable' ? '0' : null) };
        const container = makeContainer();
        const result = await bootstrapServiceWorker(container, '', storage);
        expect(result).toBe('registered');
        expect(container.registerCalls).toEqual(['/sw.js']);
    });
});
