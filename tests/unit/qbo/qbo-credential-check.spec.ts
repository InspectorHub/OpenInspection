/**
 * `checkIntuitCredentials` answers one question: are this Client ID and secret a
 * matching pair? It posts a code exchange with a made-up code; Intuit checks the
 * client first, so a good pair is refused with `invalid_grant` and a bad one
 * with `invalid_client`.
 *
 * The important property is what is NOT reported as a bad pair: anything that
 * is not an explicit refusal of the client (network failure, timeout, 5xx, 429,
 * a body that is not JSON) must come back `unreachable`, never `rejected`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logged: unknown[][] = [];
vi.mock('../../../server/lib/logger', () => ({
    logger: {
        info: (...a: unknown[]) => { logged.push(a); },
        warn: (...a: unknown[]) => { logged.push(a); },
        error: (...a: unknown[]) => { logged.push(a); },
        debug: (...a: unknown[]) => { logged.push(a); },
    },
}));

// eslint-disable-next-line import/order
import { checkIntuitCredentials } from '../../../server/services/qbo/credential-check';
// eslint-disable-next-line import/order
import { qboRedirectUri } from '../../../server/lib/qbo-oauth-paths';

const CLIENT_ID = 'ABid-0123456789-distinctive';
const CLIENT_SECRET = 'sEcReT-9876543210-distinctive';
const REDIRECT = qboRedirectUri('https://oi.example.test');
const CREDS = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
});
const stub = (impl: (url: string, init: RequestInit) => Promise<Response>) =>
    vi.fn(impl as unknown as typeof fetch);

beforeEach(() => { logged.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('checkIntuitCredentials verdicts', () => {
    it('reports a pair Intuit refuses only for the made-up code as paired', async () => {
        const f = stub(async () => json(400, { error: 'invalid_grant' }));
        expect(await checkIntuitCredentials({ fetch: f }, CREDS)).toEqual({ result: 'paired' });
    });

    it('reports a pair Intuit does not recognise as rejected (control for the above)', async () => {
        const f401 = stub(async () => json(401, { error: 'invalid_client' }));
        const f400 = stub(async () => json(400, { error: 'invalid_client' }));
        expect(await checkIntuitCredentials({ fetch: f401 }, CREDS)).toEqual({ result: 'rejected' });
        expect(await checkIntuitCredentials({ fetch: f400 }, CREDS)).toEqual({ result: 'rejected' });
    });

    it('does not take a 401 for a rejection unless Intuit says invalid_client', async () => {
        // A gateway or firewall in front of Intuit can answer 401 in JSON too.
        const gateway = stub(async () => json(401, { message: 'Unauthorized' }));
        expect(await checkIntuitCredentials({ fetch: gateway }, CREDS)).toEqual({ result: 'unreachable' });
        // Control: Intuit's own answer is still a rejection.
        const intuit = stub(async () => json(401, { error: 'invalid_client' }));
        expect(await checkIntuitCredentials({ fetch: intuit }, CREDS)).toEqual({ result: 'rejected' });
    });

    it('reports a network failure as unreachable, not rejected', async () => {
        const f = stub(async () => { throw new TypeError('fetch failed'); });
        expect(await checkIntuitCredentials({ fetch: f }, CREDS)).toEqual({ result: 'unreachable' });
    });

    it('reports a timeout as unreachable, and bounds the wait at 10 seconds', async () => {
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        let seen: unknown;
        const f = stub(async (_u, init) => {
            seen = init.signal;
            throw new DOMException('The operation timed out', 'TimeoutError');
        });
        expect(await checkIntuitCredentials({ fetch: f }, CREDS)).toEqual({ result: 'unreachable' });
        expect(timeout).toHaveBeenCalledWith(10_000);
        // Asserted after the call: inside the stub a failure would be swallowed as unreachable.
        expect(seen).toBeInstanceOf(AbortSignal);
    });

    it('reports 5xx, 429 and an unexpected status as unreachable', async () => {
        for (const status of [500, 502, 503, 429, 403, 404]) {
            const f = stub(async () => json(status, { error: 'something' }));
            expect(await checkIntuitCredentials({ fetch: f }, CREDS), `status ${status}`).toEqual({ result: 'unreachable' });
        }
        // A 400 that is neither of the two known answers says nothing about the pair.
        const other = stub(async () => json(400, { error: 'invalid_request' }));
        expect(await checkIntuitCredentials({ fetch: other }, CREDS)).toEqual({ result: 'unreachable' });
    });

    it('reports a body that is not JSON as unreachable, even with a 401 or 400 status', async () => {
        for (const status of [200, 400, 401, 502]) {
            const f = stub(async () => new Response('<html>gateway</html>', { status }));
            expect(await checkIntuitCredentials({ fetch: f }, CREDS), `status ${status}`).toEqual({ result: 'unreachable' });
        }
    });
});

describe('checkIntuitCredentials request', () => {
    it('posts the code exchange to the shared token endpoint with the pair as Basic auth', async () => {
        const f = stub(async () => json(400, { error: 'invalid_grant' }));
        await checkIntuitCredentials({ fetch: f }, CREDS);

        expect(f).toHaveBeenCalledTimes(1);
        const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
        expect(url).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
        expect(init.method).toBe('POST');
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Basic ' + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`));
        const body = new URLSearchParams(String(init.body));
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBeTruthy();
        // The same string the connect flow registers, built by the same function.
        expect(body.get('redirect_uri')).toBe(REDIRECT);
    });
});

describe('checkIntuitCredentials keeps the credentials to itself', () => {
    const leaks = (text: string) => [CLIENT_ID, CLIENT_SECRET, btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)]
        .filter((s) => text.includes(s));

    it('puts no credential, header or Intuit response text in the result or the log', async () => {
        const intuitBody = { error: 'invalid_client', error_description: 'echoed: ' + CLIENT_SECRET };
        for (const f of [
            stub(async () => json(401, intuitBody)),
            stub(async () => json(400, { error: 'invalid_grant', error_description: 'echoed ' + CLIENT_ID })),
            stub(async () => { throw new Error(`boom ${CLIENT_SECRET}`); }),
            stub(async () => json(500, intuitBody)),
        ]) {
            logged.length = 0;
            const out = await checkIntuitCredentials({ fetch: f }, CREDS);
            expect(leaks(JSON.stringify(out))).toEqual([]);
            expect(leaks(JSON.stringify(logged))).toEqual([]);
            expect(JSON.stringify(logged)).not.toContain('echoed');
            expect(Object.keys(out)).toEqual(['result']);
        }
    });

    it('does hand the credentials to Intuit (control: the leak check above can fail)', async () => {
        const f = stub(async () => json(400, { error: 'invalid_grant' }));
        await checkIntuitCredentials({ fetch: f }, CREDS);
        const init = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
        expect(leaks(JSON.stringify(init.headers))).toHaveLength(1);
        expect(leaks(JSON.stringify({ x: CLIENT_ID }))).toEqual([CLIENT_ID]);
    });

    it('does not throw when the transport throws', async () => {
        const f = stub(async () => { throw new Error(CLIENT_SECRET); });
        await expect(checkIntuitCredentials({ fetch: f }, CREDS)).resolves.toEqual({ result: 'unreachable' });
    });
});
