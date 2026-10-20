import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { AppEnv } from '../../../server/types/hono';
import type { McpProps } from '../../../server/lib/mcp/build-server';
import type { InProcessApp } from '../../../server/lib/api-app';

// isGrantUserActive reads one `users` row through drizzle(env.DB). A stub chain
// answers it, so this spec exercises the real keyring and signer and the hand-off
// to the registered app without a database.
const userRow = vi.hoisted(() => ({ current: { id: 'u-1' } as { id: string } | undefined }));
vi.mock('drizzle-orm/d1', () => ({
    drizzle: () => ({
        select: () => ({ from: () => ({ where: () => ({ get: async () => userRow.current }) }) }),
    }),
}));

const pair = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const env = {
    DB: {},
    JWT_CURRENT_KID: 'v1',
    JWT_PRIVATE_KEY_V1: pair.privateKey,
    JWT_PUBLIC_KEY_V1: pair.publicKey,
} as unknown as AppEnv;

const props: McpProps = { userId: 'u-1', tenantId: 't-1', tenantSlug: 'acme', role: 'inspector', scopes: ['read:inspections'] };
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

interface Seen { req: Request; env: unknown; ctx: unknown }

async function load() {
    vi.resetModules();
    const registry = await import('../../../server/lib/api-app');
    const bridge = await import('../../../server/lib/mcp/identity-bridge');
    const keyring = await import('../../../server/lib/jwt-keyring');
    return { ...registry, ...bridge, ...keyring };
}

describe('callApiAsUser', () => {
    beforeEach(() => {
        userRow.current = { id: 'u-1' };
    });

    it('hands the request to the registered app with a bearer minted for the grant user, and the same env and ctx', async () => {
        const m = await load();
        const seen: Seen[] = [];
        const answer = new Response('from-app', { status: 207 });
        const app: InProcessApp = {
            fetch: async (req, e, c) => {
                seen.push({ req, env: e, ctx: c });
                return answer;
            },
            getOpenAPIDocument: () => ({}),
        };
        m.registerApiAppLoader(async () => app);

        const original = new Request('https://app.example.com/api/inspections?x=1', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-keep': 'yes' },
            body: JSON.stringify({ a: 1 }),
        });
        const res = await m.callApiAsUser(env, props, original, ctx);

        expect(res).toBe(answer);
        expect(seen).toHaveLength(1);
        const got = seen[0]!;
        expect(got.env).toBe(env);
        expect(got.ctx).toBe(ctx);
        expect(got.req.method).toBe('POST');
        expect(got.req.url).toBe('https://app.example.com/api/inspections?x=1');
        expect(got.req.headers.get('x-keep')).toBe('yes');
        expect(await got.req.text()).toBe('{"a":1}');

        const auth = got.req.headers.get('authorization');
        expect(auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
        const keyring = await m.buildKeyring(env as never);
        const claims = await m.verifyJwt(auth!.slice('Bearer '.length), keyring);
        expect(claims['sub']).toBe('u-1');
        expect(claims['custom:userRole']).toBe('inspector');
        expect(claims['custom:tenantId']).toBe('t-1');
        // The caller's own request is not mutated: the DO may reuse it.
        expect(original.headers.get('authorization')).toBeNull();
    });

    it('replaces an Authorization header the incoming request already carried', async () => {
        const m = await load();
        let seenAuth: string | null = null;
        m.registerApiAppLoader(async () => ({
            fetch: async (req: Request) => {
                seenAuth = req.headers.get('authorization');
                return new Response('ok');
            },
            getOpenAPIDocument: () => ({}),
        }));
        await m.callApiAsUser(env, props, new Request('https://app.example.com/api/x', { headers: { authorization: 'Bearer caller-supplied' } }), ctx);
        expect(seenAuth).not.toBeNull();
        expect(seenAuth).not.toBe('Bearer caller-supplied');
    });

    it('answers 401 without reaching the app when the grant user is no longer active (control for the dispatch above)', async () => {
        const m = await load();
        const fetchSpy = vi.fn(async () => new Response('should not run'));
        m.registerApiAppLoader(async () => ({ fetch: fetchSpy, getOpenAPIDocument: () => ({}) }));
        userRow.current = undefined;
        const res = await m.callApiAsUser(env, props, new Request('https://app.example.com/api/x'), ctx);
        expect(res.status).toBe(401);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects, rather than dispatching anywhere, when no app loader is registered', async () => {
        const m = await load();
        await expect(m.callApiAsUser(env, props, new Request('https://app.example.com/api/x'), ctx)).rejects.toThrow(/loader is not registered/);
    });
});
