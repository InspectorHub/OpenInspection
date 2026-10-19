import { describe, it, expect, vi } from 'vitest';
import { classifyResponse, IMPORT_LIMIT_CEILINGS } from '@core/offline-package';
import { defaultSendTimeoutMs, MAX_SEND_TIMEOUT_MS, MIN_SEND_TIMEOUT_MS, sendOfflinePackage } from './offline-package-send';

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response | Promise<Response>) {
    const calls: Call[] = [];
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return respond();
    });
    return { impl: impl as unknown as typeof fetch, calls };
}

const json = (status: number, value: unknown): Response =>
    new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const CONFIRMED = {
    success: true,
    data: { inspections: 1, photos: 0, outbox: { applied: 0, skipped: 0, failed: [] }, yjs: { changed: 1, unchanged: 0 } },
};

const bytes = (n: number): Uint8Array => new Uint8Array(n);

describe('defaultSendTimeoutMs', () => {
    it('grows with the size of the package so a slow uplink can finish a large upload', () => {
        expect(defaultSendTimeoutMs(IMPORT_LIMIT_CEILINGS.compressedBytes)).toBeGreaterThan(defaultSendTimeoutMs(1024));
        // 24 MiB at 1.5 Mbps takes about 134 s; the default must outlast it.
        expect(defaultSendTimeoutMs(IMPORT_LIMIT_CEILINGS.compressedBytes)).toBeGreaterThan(134_000);
    });

    it('never drops below the base allowance and never exceeds the cap', () => {
        expect(defaultSendTimeoutMs(0)).toBe(MIN_SEND_TIMEOUT_MS);
        expect(defaultSendTimeoutMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_SEND_TIMEOUT_MS);
    });
});

describe('sendOfflinePackage request shape', () => {
    it('posts the zip to the same-origin import path with the session cookie and nothing else', async () => {
        const { impl, calls } = fakeFetch(() => json(200, CONFIRMED));
        await sendOfflinePackage(bytes(10), { fetchImpl: impl });

        expect(calls).toHaveLength(1);
        const { url, init } = calls[0]!;
        expect(url).toBe('/api/client/import');
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('same-origin');
        const headers = new Headers(init.headers);
        expect(headers.get('content-type')).toBe('application/zip');
        // The browser sets Content-Length from the Blob; setting it by hand is forbidden.
        expect(headers.has('content-length')).toBe(false);
        expect(headers.has('authorization')).toBe(false);
        expect(init.body).toBeInstanceOf(Blob);
        expect((init.body as Blob).size).toBe(10);
    });
});

describe('sendOfflinePackage answers', () => {
    it('keeps a success body so the classifier can confirm it', async () => {
        const { impl } = fakeFetch(() => json(200, CONFIRMED));
        const result = await sendOfflinePackage(bytes(1), { fetchImpl: impl });
        expect(result.status).toBe(200);
        expect(classifyResponse(result, 1).kind).toBe('confirmed');
    });

    it('parses the error body into code and details and does not swallow it', async () => {
        const details = { inspectionId: 'insp-1' };
        const { impl } = fakeFetch(() => json(404, { success: false, error: { code: 'NOT_FOUND', message: 'x', details } }));
        const result = await sendOfflinePackage(bytes(1), { fetchImpl: impl });
        expect(result).toMatchObject({ status: 404, code: 'NOT_FOUND', details });
        expect(result.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
        expect(classifyResponse(result)).toMatchObject({ kind: 'splittable', ids: ['insp-1'] });
    });

    it('returns a non-JSON answer as status plus truncated text, which a 200 never confirms', async () => {
        const page = '<html>' + 'x'.repeat(5000);
        const { impl } = fakeFetch(() => new Response(page, { status: 200, headers: { 'content-type': 'text/html' } }));
        const result = await sendOfflinePackage(bytes(1), { fetchImpl: impl });
        expect(result.status).toBe(200);
        expect(typeof result.body).toBe('string');
        expect((result.body as string).length).toBeLessThanOrEqual(2000);
        expect(result.code).toBeUndefined();
        expect(classifyResponse(result, 1).kind).toBe('retry');
    });

    it('treats a non-JSON gateway error as a retry', async () => {
        const { impl } = fakeFetch(() => new Response('Bad Gateway', { status: 502 }));
        const result = await sendOfflinePackage(bytes(1), { fetchImpl: impl });
        expect(classifyResponse(result).kind).toBe('retry');
    });

    it('does not treat a 200 with missing fields as confirmed', async () => {
        const { impl } = fakeFetch(() => json(200, { success: true, data: { inspections: 1 } }));
        const result = await sendOfflinePackage(bytes(1), { fetchImpl: impl });
        expect(classifyResponse(result, 1).kind).toBe('retry');
    });
});

describe('sendOfflinePackage failures with no answer', () => {
    it('rejects when the network fails', async () => {
        const { impl } = fakeFetch(() => { throw new TypeError('Failed to fetch'); });
        await expect(sendOfflinePackage(bytes(1), { fetchImpl: impl })).rejects.toThrow('Failed to fetch');
    });

    it('rejects when the request outlives its timeout, and aborts it', async () => {
        let aborted = false;
        const impl = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => { aborted = true; reject(init.signal?.reason); });
        })) as unknown as typeof fetch;
        await expect(sendOfflinePackage(bytes(1), { fetchImpl: impl, timeoutMs: 20 })).rejects.toThrow('timed out');
        expect(aborted).toBe(true);
    });

    it('rejects when the caller aborts', async () => {
        const controller = new AbortController();
        const impl = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted by caller')));
        })) as unknown as typeof fetch;
        const pending = sendOfflinePackage(bytes(1), { fetchImpl: impl, signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toThrow('aborted by caller');
    });

    it('rejects without sending when the caller aborted already', async () => {
        const controller = new AbortController();
        controller.abort(new Error('already aborted'));
        const impl = ((_url: string, init?: RequestInit) => init?.signal?.aborted
            ? Promise.reject(init.signal.reason)
            : Promise.resolve(json(200, CONFIRMED))) as unknown as typeof fetch;
        await expect(sendOfflinePackage(bytes(1), { fetchImpl: impl, signal: controller.signal })).rejects.toThrow('already aborted');
    });
});

describe('sendOfflinePackage size precheck', () => {
    const max = IMPORT_LIMIT_CEILINGS.compressedBytes;

    it('does not send a package over the compressed ceiling and says why', async () => {
        const { impl, calls } = fakeFetch(() => json(200, CONFIRMED));
        const result = await sendOfflinePackage(bytes(max + 1), { fetchImpl: impl });
        expect(calls).toHaveLength(0);
        expect(result).toMatchObject({ status: 413, code: 'PACKAGE_TOO_LARGE', details: { limit: 'compressedBytes', max, actual: max + 1 } });
        expect(classifyResponse(result).kind).toBe('too_large');
    });

    it('sends a package exactly at the ceiling (positive control)', async () => {
        const { impl, calls } = fakeFetch(() => json(200, CONFIRMED));
        const result = await sendOfflinePackage(bytes(max), { fetchImpl: impl });
        expect(calls).toHaveLength(1);
        expect(result.status).toBe(200);
    });
});
