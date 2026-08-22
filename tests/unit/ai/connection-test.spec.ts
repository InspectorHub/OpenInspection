import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testAiConnection } from '../../../server/lib/ai/connection-test';
import { OpenAiCompatibleProvider, PROVIDER_REJECTED_MESSAGE } from '../../../server/lib/ai/providers/openai-compatible';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

const OK = () => new Response(
    JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 },
);

const input = { baseUrl: 'https://api.example.test/openai/v1', model: 'a-model', apiKey: 'k' };

/**
 * THE FAILURE THIS FILE EXISTS TO PREVENT.
 *
 * The diagnostic it replaces probed a DEPLOYMENT environment key against one
 * vendor's model-list endpoint. After the multi-provider change that tests
 * nothing a workspace call uses: a workspace could save an unreachable base
 * URL and a model that does not exist, see a green tick, and discover the
 * truth mid-inspection. A connection test that tests something other than what
 * was saved is worse than no test at all, because it converts an unknown into
 * a wrong answer.
 *
 * So the first three cases below are not about error handling. They pin that
 * the probe uses the SUBMITTED endpoint, the SUBMITTED model and the SUBMITTED
 * key, and the last one pins that it reaches the same URL the real call will.
 */
describe('AI connection test — it tests what was saved', () => {
    it('posts to the submitted base URL, not to any deployment default', async () => {
        fetchMock.mockResolvedValue(OK());
        expect(await testAiConnection(input)).toEqual({ ok: true });
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/openai/v1/chat/completions');
    });

    it('sends the submitted model and the submitted key', async () => {
        fetchMock.mockResolvedValue(OK());
        await testAiConnection(input);
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(init.body as string)).toMatchObject({ model: 'a-model' });
        expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer k');
    });

    it('reaches the very same URL the real call would', async () => {
        // The structural guarantee, not a restatement of the first case: both
        // paths derive the URL from one exported helper, so a change to how the
        // adapter addresses a provider cannot leave the diagnostic testing an
        // address nothing else uses.
        fetchMock.mockResolvedValue(OK());
        await testAiConnection(input);
        const probed = fetchMock.mock.calls[0][0];

        fetchMock.mockClear();
        await new OpenAiCompatibleProvider(input).complete({ prompt: 'p' });
        expect(fetchMock.mock.calls[0][0]).toBe(probed);
    });

    it('asks for a trivial completion rather than a full one', async () => {
        // A diagnostic that generated 1024 tokens would bill the workspace for
        // pressing Test. One token is enough to prove the round trip.
        fetchMock.mockResolvedValue(OK());
        await testAiConnection(input);
        const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
        expect(body.max_tokens).toBe(1);
    });
});

describe('AI connection test — which field it blames', () => {
    it('names the base URL when the host cannot be reached', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));
        expect(await testAiConnection(input)).toMatchObject({ ok: false, field: 'baseUrl' });
    });

    it('names the key for every credential-family status, with one sentence', async () => {
        for (const status of [401, 402, 403, 429]) {
            fetchMock.mockResolvedValue(new Response('no', { status }));
            const r = await testAiConnection(input);
            expect(r).toMatchObject({ ok: false, field: 'apiKey' });
            expect((r as { message: string }).message).toBe(PROVIDER_REJECTED_MESSAGE);
        }
    });

    it('never tells the workspace their provider account is unpaid', async () => {
        // 402 is a number this codebase did not author, not a finding about
        // someone else's commercial relationship.
        fetchMock.mockResolvedValue(new Response('no', { status: 402 }));
        const r = await testAiConnection(input);
        expect(JSON.stringify(r)).not.toMatch(/unpaid|payment required|overdue|past due/i);
        expect(JSON.stringify(r)).not.toMatch(/\b402\b/);
    });

    it('names the model when the provider says it does not recognise it', async () => {
        // The one cause statable with confidence — the id was sent from here.
        fetchMock.mockResolvedValue(new Response('unknown model', { status: 404 }));
        expect(await testAiConnection(input)).toMatchObject({ ok: false, field: 'model' });
    });

    it('blames the endpoint, not the key, for a server-side failure', async () => {
        // The positive control on the blame mapping: without it, a function
        // that answered `apiKey` for every non-OK status would pass every
        // negative assertion above.
        fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
        expect(await testAiConnection(input)).toMatchObject({ ok: false, field: 'baseUrl' });
    });

    it('never returns the provider body to the client', async () => {
        fetchMock.mockResolvedValue(new Response('echo: 12 Oak St, Jane Doe', { status: 401 }));
        const r = await testAiConnection(input);
        expect(JSON.stringify(r)).not.toContain('Oak St');
        expect(JSON.stringify(r)).not.toContain('Jane Doe');
    });

    it('never returns the submitted key to the client either', async () => {
        fetchMock.mockResolvedValue(new Response('no', { status: 401 }));
        const r = await testAiConnection({ ...input, apiKey: 'sk-secret-value' });
        expect(JSON.stringify(r)).not.toContain('sk-secret-value');
    });
});
