import { describe, it, expect, vi } from 'vitest';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { markNativeSessionEnd, withSessionEndReason } from '../../../server/lib/auth/native-session-end';
import { revokeAllUserGrants } from '../../../server/lib/mcp/grants';

const ctx = {} as ExecutionContext;
const GRANT = 'abc_DEF-0123456789';
const REFUSED = JSON.stringify({ error: 'invalid_grant', error_description: 'Grant not found' });
const refusal = () => new Response(REFUSED, { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': String(REFUSED.length) } });

function fakeKv(store: Record<string, string> = {}, opts: { throwOnGet?: boolean } = {}) {
    const get = vi.fn(async (k: string) => { if (opts.throwOnGet) throw new Error('kv down'); return store[k] ?? null; });
    const put = vi.fn(async (k: string, v: string) => { store[k] = v; });
    return { kv: { get, put } as unknown as KVNamespace, get, put, store };
}

function refreshRequest(refreshToken: string, extra: Record<string, string> = {}, path = '/oauth/token') {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, ...extra }).toString();
    return new Request(`https://app.example.com${path}`, {
        method: 'POST', body,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(body.length) },
    });
}

const token = `user1:${GRANT}:secret`;

describe('withSessionEndReason', () => {
    it('adds the reason to a refused refresh whose grant has a marker, keeping status and headers', async () => {
        const { kv } = fakeKv({ [`native-end:${GRANT}`]: 'member_removed' });
        const res = await withSessionEndReason(async () => refusal(), kv)(refreshRequest(token), {}, ctx);
        expect(res.status).toBe(400);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('content-type')).toBe('application/json');
        const text = await res.text();
        expect(res.headers.get('content-length')).toBeNull();
        expect(JSON.parse(text)).toEqual({ error: 'invalid_grant', error_description: 'Grant not found', session_end_reason: 'member_removed' });
    });

    it('CONTROL: the same refusal with no marker is the original response, byte for byte', async () => {
        const { kv, get } = fakeKv();
        const res = await withSessionEndReason(async () => refusal(), kv)(refreshRequest(token), {}, ctx);
        expect(get).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(400);
        expect(await res.text()).toBe(REFUSED);
    });

    it('ignores a marker value outside the allowlist', async () => {
        const { kv } = fakeKv({ [`native-end:${GRANT}`]: 'something_else' });
        const res = await withSessionEndReason(async () => refusal(), kv)(refreshRequest(token), {}, ctx);
        expect(await res.text()).toBe(REFUSED);
    });

    it('does not read KV for an answer that is not a 400 invalid_grant', async () => {
        const { kv, get } = fakeKv({ [`native-end:${GRANT}`]: 'member_removed' });
        const ok = new Response('{"access_token":"x"}', { status: 200 });
        const other = new Response('{"error":"invalid_request"}', { status: 400 });
        expect(await (await withSessionEndReason(async () => ok.clone(), kv)(refreshRequest(token), {}, ctx)).text()).toBe('{"access_token":"x"}');
        expect(await (await withSessionEndReason(async () => other.clone(), kv)(refreshRequest(token), {}, ctx)).text()).toBe('{"error":"invalid_request"}');
        const wrongStatus = await withSessionEndReason(async () => new Response(REFUSED, { status: 401 }), kv)(refreshRequest(token), {}, ctx);
        expect(await wrongStatus.text()).toBe(REFUSED);
        expect(get).not.toHaveBeenCalled();
    });

    it('returns the original response when the KV read throws', async () => {
        const { kv } = fakeKv({}, { throwOnGet: true });
        const res = await withSessionEndReason(async () => refusal(), kv)(refreshRequest(token), {}, ctx);
        expect(res.status).toBe(400);
        expect(await res.text()).toBe(REFUSED);
    });

    it('passes everything that is not a refresh through untouched, without a KV read, and the provider still reads the body', async () => {
        const { kv, get } = fakeKv({ [`native-end:${GRANT}`]: 'member_removed' });
        let seen = '';
        const inner = vi.fn(async (r: Request) => { seen = await r.text(); return refusal(); });
        const wrapped = withSessionEndReason(inner, kv);
        const codeBody = new URLSearchParams({ grant_type: 'authorization_code', code: 'c' }).toString();
        const cases: Request[] = [
            new Request('https://app.example.com/oauth/token', { method: 'POST', body: codeBody, headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(codeBody.length) } }),
            refreshRequest(token, {}, '/oauth/other'),
            refreshRequest('not-three-segments'),
            refreshRequest('user1:bad:grant!:secret'),
            refreshRequest(`user1:${'a'.repeat(65)}:secret`),
            new Request('https://app.example.com/oauth/token', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'content-length': '2' } }),
        ];
        for (const req of cases) {
            const res = await wrapped(req, {}, ctx);
            expect(await res.text()).toBe(REFUSED);
        }
        expect(get).not.toHaveBeenCalled();
        expect(seen).toBe('{}');
        // CONTROL: the clone did not consume the stream of a request that IS read.
        await wrapped(refreshRequest(token), {}, ctx);
        expect(seen).toContain('grant_type=refresh_token');
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('does not echo the refresh token or the user id', async () => {
        const { kv } = fakeKv({ [`native-end:${GRANT}`]: 'member_removed' });
        const text = await (await withSessionEndReason(async () => refusal(), kv)(refreshRequest(token), {}, ctx)).text();
        expect(text).not.toContain('secret');
        expect(text).not.toContain('user1');
    });

    it('reads the marker under the grant id of the token, so another grant id sees nothing (isolation)', async () => {
        const { kv } = fakeKv({ [`native-end:${GRANT}`]: 'member_removed' });
        const res = await withSessionEndReason(async () => refusal(), kv)(refreshRequest('user2:OtherGrant0000001:secret'), {}, ctx);
        expect(await res.text()).toBe(REFUSED);
    });
});

describe('markNativeSessionEnd and the revoke path', () => {
    it('a failing KV write is swallowed', async () => {
        const kv = { put: vi.fn(async () => { throw new Error('nope'); }) } as unknown as KVNamespace;
        await expect(markNativeSessionEnd(kv, GRANT, 'member_removed')).resolves.toBeUndefined();
    });

    function provider() {
        const calls: string[] = [];
        const oauth = {
            listUserGrants: vi.fn(async () => ({ items: [{ id: 'gNative', metadata: { kind: 'native' } }, { id: 'gMcp', metadata: { kind: 'mcp' } }] })),
            revokeGrant: vi.fn(async (id: string) => { calls.push(`revoke:${id}`); }),
        } as unknown as OAuthHelpers;
        return { oauth, calls };
    }

    it('marks only native grants, before revoking them', async () => {
        const { oauth, calls } = provider();
        const kv = { put: vi.fn(async (k: string) => { calls.push(`mark:${k}`); }) } as unknown as KVNamespace;
        await revokeAllUserGrants(oauth, 'u1', { kv, reason: 'member_removed' });
        expect(calls.indexOf('mark:native-end:gNative')).toBeGreaterThanOrEqual(0);
        expect(calls.indexOf('mark:native-end:gNative')).toBeLessThan(calls.indexOf('revoke:gNative'));
        expect(calls).not.toContain('mark:native-end:gMcp');
        expect(calls).toContain('revoke:gMcp');
    });

    it('CONTROL: without an end argument both grants are still revoked', async () => {
        const { oauth, calls } = provider();
        await revokeAllUserGrants(oauth, 'u1');
        expect(calls.sort()).toEqual(['revoke:gMcp', 'revoke:gNative']);
    });
});
