/**
 * A deployment credential that refreshes itself.
 *
 * The backend this exists for authenticates with an OAuth access token, not
 * with a key that lasts. Obtaining one means signing an assertion with the
 * deployment's own private key and exchanging it — two steps this repository
 * already performs separately elsewhere, and neither of which may put key
 * material anywhere it could be read back.
 *
 * NO KEY IS COMMITTED. Every test below generates a throwaway keypair at run
 * time, which is also the only honest way to prove the signing path works:
 * a fixture key would prove the code accepts a fixture.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createServiceAccountTokenSource,
    parseServiceAccountJson,
    CLOUD_PLATFORM_SCOPE,
    VERTEX_PROVIDER_ID,
} from '../../../server/lib/ai/credentials/google-service-account';

const TOKEN_URI = 'https://oauth2.googleapis.test/token';

/** A real RSA private key in the PKCS8 PEM form a service account carries. */
async function generatePrivateKeyPem(): Promise<string> {
    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
    );
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
    const lines = b64.match(/.{1,64}/g) ?? [];
    return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

let privateKeyPem: string;
let fetchMock: ReturnType<typeof vi.fn>;

/** A distinct identity per test. The token cache is keyed on it, so this is
 *  what keeps one test's cached token out of the next test — no reset hook,
 *  and therefore no test-only export on the module under test. */
let seq = 0;
const account = () => ({
    client_email: `sa-${++seq}@example.iam.gserviceaccount.test`,
    private_key: privateKeyPem,
    token_uri: TOKEN_URI,
});

const tokenResponse = (token: string, expiresIn = 3600) => Promise.resolve(new Response(
    JSON.stringify({ access_token: token, expires_in: expiresIn, token_type: 'Bearer' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
));

beforeEach(async () => {
    privateKeyPem ??= await generatePrivateKeyPem();
    fetchMock = vi.fn().mockImplementation(() => tokenResponse('tok-A'));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

const decodeSegment = (seg: string): Record<string, unknown> => {
    const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
    const b64 = (seg + pad).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
};

describe('the service-account token source', () => {
    it('exchanges a signed assertion for an access token', async () => {
        const sa = account();
        const source = createServiceAccountTokenSource(sa);
        expect(await source.getAccessToken()).toBe('tok-A');

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(TOKEN_URI);
        expect(init.method).toBe('POST');
        expect((init.headers as Record<string, string>)['Content-Type'])
            .toBe('application/x-www-form-urlencoded');

        const form = new URLSearchParams(init.body as string);
        expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

        const assertion = form.get('assertion') ?? '';
        const [h, p] = assertion.split('.');
        expect(decodeSegment(h as string)).toMatchObject({ alg: 'RS256', typ: 'JWT' });
        const claims = decodeSegment(p as string);
        expect(claims).toMatchObject({
            iss: sa.client_email,
            aud: TOKEN_URI,
            scope: CLOUD_PLATFORM_SCOPE,
        });
        // An assertion with no expiry, or one already expired, is rejected by
        // the exchange — so the window is part of what "it works" means.
        expect(claims['exp'] as number).toBeGreaterThan(claims['iat'] as number);
    });

    it('mints once and serves the cached token afterwards', async () => {
        // A worker isolate handles many requests. Minting per request would
        // add a round trip to every AI call and would rate-limit the
        // deployment for no benefit — the token is valid for an hour.
        const source = createServiceAccountTokenSource(account());
        expect(await source.getAccessToken()).toBe('tok-A');
        expect(await source.getAccessToken()).toBe('tok-A');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('serves one in-flight mint to callers that arrive together', async () => {
        // Two requests entering a cold isolate at the same moment must not
        // both start an exchange. Without single-flight the cache is written
        // twice and the token endpoint sees avoidable duplicate traffic.
        const source = createServiceAccountTokenSource(account());
        const [a, b] = await Promise.all([source.getAccessToken(), source.getAccessToken()]);
        expect(a).toBe('tok-A');
        expect(b).toBe('tok-A');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('mints again once the cached token is close enough to expiry', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-24T00:00:00Z'));
        const source = createServiceAccountTokenSource(account());
        expect(await source.getAccessToken()).toBe('tok-A');

        // Still comfortably inside the hour: the cache must hold.
        vi.setSystemTime(new Date('2026-08-24T00:30:00Z'));
        expect(await source.getAccessToken()).toBe('tok-A');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Inside the refresh margin: a token that is still technically valid
        // is replaced early, because a call starting now could finish after it
        // expired.
        fetchMock.mockImplementation(() => tokenResponse('tok-B'));
        vi.setSystemTime(new Date('2026-08-24T00:57:00Z'));
        expect(await source.getAccessToken()).toBe('tok-B');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws without putting the private key or a token into the message', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(new Response(
            JSON.stringify({ error: 'invalid_grant', error_description: privateKeyPem }),
            { status: 400 },
        )));
        const source = createServiceAccountTokenSource(account());

        const err = await source.getAccessToken().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        const text = `${(err as Error).message}\n${(err as Error).stack ?? ''}`;
        expect(text).not.toContain('BEGIN PRIVATE KEY');
        expect(text).not.toContain(privateKeyPem.slice(40, 90));
    });

    it('does not cache a failed exchange', async () => {
        // A refusal cached would turn one bad minute into an hour of them.
        fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 500 })));
        const source = createServiceAccountTokenSource(account());
        await source.getAccessToken().catch(() => {});

        fetchMock.mockImplementation(() => tokenResponse('tok-C'));
        expect(await source.getAccessToken()).toBe('tok-C');
    });

    it('declares the backend it belongs to, so provenance does not read a model string', async () => {
        expect(createServiceAccountTokenSource(account()).providerId).toBe(VERTEX_PROVIDER_ID);
        // Pinned as a literal too: this string is written into a provenance
        // ledger, so renaming the constant must not quietly relabel rows.
        expect(VERTEX_PROVIDER_ID).toBe('vertex-ai');
    });
});

describe('parsing the credential a deployment supplies', () => {
    it('accepts a well-formed service account', () => {
        const sa = account();
        const parsed = parseServiceAccountJson(JSON.stringify(sa));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.account.client_email).toBe(sa.client_email);
    });

    it('names the field that is missing, and quotes no value', () => {
        // The operator reading the log has to learn WHICH half they left out.
        // A generic "invalid credential" would make them re-paste the whole
        // thing to find out.
        const { private_key: _dropped, ...rest } = account();
        const parsed = parseServiceAccountJson(JSON.stringify(rest));
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            expect(parsed.missing).toContain('private_key');
            expect(parsed.missing).not.toContain(privateKeyPem.slice(40, 90));
        }
    });

    it('reports unparseable input rather than throwing', () => {
        const parsed = parseServiceAccountJson('{not json');
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.missing.length).toBeGreaterThan(0);
    });

    it('falls back to the shared token endpoint when the document omits one', () => {
        const { token_uri: _absent, ...rest } = account();
        const parsed = parseServiceAccountJson(JSON.stringify(rest));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.account.token_uri).toMatch(/^https:\/\//);
    });
});
