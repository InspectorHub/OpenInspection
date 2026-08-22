import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAiCompatibleProvider } from '../../../server/lib/ai/providers/openai-compatible';
import { AppError, ErrorCode } from '../../../server/lib/errors';
import { logger } from '../../../server/lib/logger';

const OK = (text: string) => new Response(
    JSON.stringify({ choices: [{ message: { content: text } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const provider = (over: Partial<{ apiKey: string; model: string; baseUrl: string }> = {}) =>
    new OpenAiCompatibleProvider({
        apiKey: 'k',
        model: 'a-model',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        ...over,
    });

const headersOf = (call: number): Record<string, string> =>
    fetchMock.mock.calls[call][1].headers as Record<string, string>;

describe('OpenAiCompatibleProvider — the request it builds', () => {
    it('posts chat completions to the configured base URL with a Bearer key', async () => {
        fetchMock.mockResolvedValue(OK('hello'));
        await provider().complete({ prompt: 'p' });

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
        expect(init.method).toBe('POST');
        expect(headersOf(0)['Authorization']).toBe('Bearer k');
        expect(JSON.parse(init.body as string)).toMatchObject({
            model: 'a-model',
            messages: [{ role: 'user', content: 'p' }],
        });
    });

    it('tolerates a base URL with or without a trailing slash', async () => {
        fetchMock.mockResolvedValue(OK('x'));
        await provider({ baseUrl: 'https://api.example.com/openai/v1' }).complete({ prompt: 'p' });
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/openai/v1/chat/completions');
    });

    it('passes the caller\'s sampling knobs through, and defaults the ones it did not set', async () => {
        fetchMock.mockResolvedValue(OK('x'));
        await provider().complete({ prompt: 'p', temperature: 0.9, maxOutputTokens: 42 });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.temperature).toBe(0.9);
        expect(body.max_tokens).toBe(42);
        expect(body.top_p).toBe(0.8);
    });

    it('sends no topK, because the OpenAI schema has no such field', async () => {
        // `AiRequest` still carries `topK` for the interface's sake. Sending it
        // to an OpenAI-compatible endpoint is at best ignored and at worst a
        // 400, so it is dropped here rather than translated into a guess.
        fetchMock.mockResolvedValue(OK('x'));
        await provider().complete({ prompt: 'p', topK: 40 });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body).not.toHaveProperty('topK');
        expect(body).not.toHaveProperty('top_k');
    });

    it('refuses to send when no model is configured', async () => {
        // Fail closed, exactly as the native adapter did: an empty model is a
        // deployment that never set AI_MODEL, not a request to guess one.
        await expect(provider({ model: '' }).complete({ prompt: 'p' })).rejects.toThrow(/model/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('OpenAiCompatibleProvider — id names the backend that actually ran', () => {
    it('derives an id from the base URL host, not from configuration', () => {
        expect(provider({ baseUrl: 'https://api.example.com/openai/v1' }).id).toBe('api.example.com');
        expect(provider({ baseUrl: 'http://192.168.1.40:11434/v1' }).id).toBe('192.168.1.40');
    });

    it('names the real vendor when routed through the gateway', () => {
        // Through Cloudflare's unified endpoint the vendor is in the MODEL
        // string, not the host — every provider would otherwise record as the
        // gateway, and the provenance ledger exists to answer which backend
        // produced a piece of text.
        const p = provider({
            baseUrl: 'https://gateway.ai.cloudflare.com/v1/acct/gw/compat/',
            model: 'google-ai-studio/a-model',
        });
        expect(p.id).toBe('google-ai-studio');
    });

    it('falls back to a stated unknown rather than throwing on an unparseable base URL', () => {
        expect(provider({ baseUrl: 'not a url' }).id).toBe('unknown');
    });
});

describe('OpenAiCompatibleProvider — which failures refuse and which throw plainly', () => {
    for (const status of [401, 402, 403, 429]) {
        it(`treats ${status} as a credential/account refusal, not a transient failure`, async () => {
            fetchMock.mockResolvedValue(new Response('nope', { status }));
            await expect(provider().complete({ prompt: 'p' })).rejects.toMatchObject({
                code: ErrorCode.AI_NOT_CONFIGURED,
                details: { reason: 'upstream_credential' },
            });
        });
    }

    it('leaves a 500 as a plain error so the caller can degrade', async () => {
        fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
        const err = await provider().complete({ prompt: 'p' }).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(AppError);
    });

    it('leaves a 404 as a plain error too — a wrong path is not a wrong key', async () => {
        // The positive control on the classification: without it, an adapter
        // that raised the refusal for every non-OK status would pass every
        // assertion in the loop above.
        fetchMock.mockResolvedValue(new Response('no such route', { status: 404 }));
        const err = await provider().complete({ prompt: 'p' }).catch((e) => e);
        expect(err).not.toBeInstanceOf(AppError);
    });

    it('never puts the upstream body in the thrown message', async () => {
        // A 4xx body can echo the request, and the request is inspection text.
        fetchMock.mockResolvedValue(new Response('prompt was: 12 Oak St, Jane Doe', { status: 401 }));
        const err = await provider().complete({ prompt: 'p' }).catch((e) => e);
        expect(String(err.message)).not.toContain('Oak St');
        expect(String(err.message)).not.toContain('Jane Doe');
    });

    it('never diagnoses the provider\'s commercial reason', async () => {
        // We know an HTTP status we did not author, not why the provider
        // refused. 402 in particular gets no payment language — "your account
        // is unpaid" is an inference about someone else's business
        // relationship, made from a number.
        for (const status of [401, 402, 403, 429]) {
            fetchMock.mockResolvedValue(new Response('x', { status }));
            const err = await provider().complete({ prompt: 'p' }).catch((e) => e);
            expect(err.message).toBe(
                'The AI provider rejected this request. Check your API key, account status, service tier, or billing configuration with your provider.',
            );
            expect(err.message).not.toMatch(/unpaid|payment required|overdue|past due/i);
            expect(err.message).not.toMatch(/\b40[123]\b|\b429\b/);
        }
    });

    it('logs the technical detail a support engineer needs, and nothing more', async () => {
        // Two layers: a raw `402` helps a developer and tells an inspector
        // nothing, so it lives here rather than in the message.
        const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
        fetchMock.mockResolvedValue(new Response('echo: 12 Oak St', { status: 402 }));
        await provider().complete({ prompt: 'p' }).catch(() => {});

        expect(logSpy).toHaveBeenCalledTimes(1);
        const [, fields] = logSpy.mock.calls[0];
        expect(fields).toMatchObject({ status: 402, provider: expect.any(String) });
        expect(JSON.stringify(fields)).not.toContain('Oak St');
        logSpy.mockRestore();
    });

    it('logs nothing at all on a successful call', async () => {
        // The positive control for the logging test: a spy that saw one call
        // proves nothing if the adapter logs on every request.
        const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
        fetchMock.mockResolvedValue(OK('fine'));
        await provider().complete({ prompt: 'p' });
        expect(logSpy).not.toHaveBeenCalled();
        logSpy.mockRestore();
    });
});

describe('OpenAiCompatibleProvider — the response it returns', () => {
    it('trims the first choice message content', async () => {
        fetchMock.mockResolvedValue(OK('  spaced  '));
        expect(await provider().complete({ prompt: 'p' })).toEqual({ text: 'spaced' });
    });

    it('throws rather than returning empty text when the shape is unexpected', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
        await expect(provider().complete({ prompt: 'p' })).rejects.toThrow();
    });
});

describe('OpenAiCompatibleProvider — gateway invariants', () => {
    const gateway = (metadata?: Record<string, string>) => new OpenAiCompatibleProvider({
        apiKey: 'k',
        model: 'google-ai-studio/a-model',
        baseUrl: 'https://gateway.ai.cloudflare.com/v1/a/g/compat/',
        ...(metadata ? { gatewayMetadata: metadata } : {}),
    });

    it('always disables payload logging when talking to the gateway', async () => {
        // The gateway stores request and response bodies BY DEFAULT, and what
        // is sent is inspection text carrying client names and addresses. A
        // dashboard setting can be changed back by anyone and nothing would
        // say so, which is why it is set here on every request instead.
        fetchMock.mockResolvedValue(OK('x'));
        await gateway().complete({ prompt: 'p' });
        expect(headersOf(0)['cf-aig-collect-log-payload']).toBe('false');
    });

    it('disables payload logging even when no metadata was supplied', async () => {
        // The two are independent: a deployment that tags nothing must not
        // thereby opt back into payload storage.
        fetchMock.mockResolvedValue(OK('x'));
        await gateway().complete({ prompt: 'p' });
        expect(headersOf(0)['cf-aig-collect-log-payload']).toBe('false');
        expect(headersOf(0)['cf-aig-metadata']).toBeUndefined();
    });

    it('sends workspace metadata so cost is attributable and spend limits can scope', async () => {
        fetchMock.mockResolvedValue(OK('x'));
        await gateway({ tenant_id: 't1', user_id: 'u1' }).complete({ prompt: 'p' });
        expect(JSON.parse(headersOf(0)['cf-aig-metadata'])).toEqual({ tenant_id: 't1', user_id: 'u1' });
    });

    it('sends neither header to a direct provider', async () => {
        // A workspace's own key and a self-hosted endpoint do not go through
        // the gateway; a gateway header on a request to someone else's API is
        // noise at best.
        fetchMock.mockResolvedValue(OK('x'));
        await provider({ baseUrl: 'https://api.example.com/openai/v1' }).complete({ prompt: 'p' });
        expect(headersOf(0)['cf-aig-collect-log-payload']).toBeUndefined();
        expect(headersOf(0)['cf-aig-metadata']).toBeUndefined();
    });

    it('is not fooled by a host that merely ends with the gateway name', async () => {
        // `endsWith` on the whole URL would match a look-alike host, and this
        // check decides whether a Cloudflare header carrying workspace ids is
        // sent to a stranger.
        fetchMock.mockResolvedValue(OK('x'));
        await new OpenAiCompatibleProvider({
            apiKey: 'k',
            model: 'm',
            baseUrl: 'https://notgateway.ai.cloudflare.com.example.com/v1/',
            gatewayMetadata: { tenant_id: 't1' },
        }).complete({ prompt: 'p' });
        expect(headersOf(0)['cf-aig-metadata']).toBeUndefined();
    });

    it('still authenticates and still posts to chat completions through the gateway', async () => {
        // The positive control: an implementation that replaced the header
        // object wholesale would pass every assertion above and send no
        // Authorization at all.
        fetchMock.mockResolvedValue(OK('x'));
        await gateway({ tenant_id: 't1' }).complete({ prompt: 'p' });
        expect(fetchMock.mock.calls[0][0])
            .toBe('https://gateway.ai.cloudflare.com/v1/a/g/compat/chat/completions');
        expect(headersOf(0)['Authorization']).toBe('Bearer k');
        expect(headersOf(0)['Content-Type']).toBe('application/json');
    });
});
