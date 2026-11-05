/**
 * The per-address limiters count a caller by network, so an IPv6 subscriber cannot dodge a limit by rotating inside its own /64,
 * and a call that reached the API without any address says so in the log instead of silently sharing one bucket.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Context } from 'hono';
import { withinRateLimit, checkRateLimit } from '../../../server/lib/rate-limit';
import { PAGE_RENDER_CALL } from '../../../server/lib/request-scope';
import { logger } from '../../../server/lib/logger';
import type { HonoConfig } from '../../../server/types/hono';

function recorder() {
    const keys: string[] = [];
    return { keys, env: { RATE_LIMITER: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true }; } } } };
}

afterEach(() => vi.restoreAllMocks());

describe('limiter keys', () => {
    it('two addresses in one IPv6 /64 share a bucket; a different /64 does not', async () => {
        const { keys, env } = recorder();
        await withinRateLimit(env, 'door', '2001:db8:aaaa:bbbb:1111:2222:3333:4444');
        await withinRateLimit(env, 'door', '2001:db8:aaaa:bbbb:ffff::1');
        await withinRateLimit(env, 'door', '2001:db8:aaaa:cccc::1');
        expect(keys[0]).toBe(keys[1]);
        expect(keys[2]).not.toBe(keys[0]);
    });

    it('IPv4 addresses and non-address scopes keep their own keys', async () => {
        const { keys, env } = recorder();
        await withinRateLimit(env, 'door', '203.0.113.7');
        await withinRateLimit(env, 'door', '203.0.113.8');
        await withinRateLimit(env, 'door', 'unknown');
        expect(keys).toEqual(['door:203.0.113.7', 'door:203.0.113.8', 'door:unknown']);
    });
});

describe('checkRateLimit without an address', () => {
    const ctx = (env: Record<string, unknown>, ip?: string) => ({
        env, req: { header: (n: string) => (n === 'CF-Connecting-IP' ? ip : undefined) },
    }) as unknown as Context<HonoConfig>;

    it('warns when an in-process page call arrives with no address, and stays quiet with one', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const { env } = recorder();
        await checkRateLimit(ctx({ ...env, [PAGE_RENDER_CALL]: true }), 'door');
        expect(warn).toHaveBeenCalledTimes(1);
        await checkRateLimit(ctx({ ...env, [PAGE_RENDER_CALL]: true }, '203.0.113.7'), 'door');
        await checkRateLimit(ctx({ ...env }), 'door');
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
