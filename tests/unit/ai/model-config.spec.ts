import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIService } from '../../../server/services/ai.service';
import { OpenAiCompatibleProvider } from '../../../server/lib/ai/providers/openai-compatible';

/**
 * The AI model is configuration, not a source-code constant.
 *
 * The request used to hardcode `gemini-1.5-flash`, so every AI feature was
 * quality-capped at one model with no way to change it. The model now arrives
 * as configuration, and — like every other credential/endpoint in this repo —
 * there is NO baked-in fallback: an unconfigured model fails closed.
 *
 * The model now travels in the request BODY rather than the URL, because the
 * OpenAI-compatible schema puts it there. That is the only thing about these
 * cases that changed; what they assert did not.
 *
 * The fail-closed cases are the load-bearing ones. A suite that only exercises
 * the configured path passes just as happily against a hardcoded default, which
 * is exactly the bug this file exists to prevent.
 */
/** The tenant's own key with a confirmation on file — the capability gate
 *  refuses anything else, and the service defaults to fail-closed. */
const OWN_CONFIRMED_KEY = { source: 'byo', tenantKeyAttested: true } as const;
/** The chokepoint refuses to run without somewhere to record the call. Supplied
 *  wherever a case is meant to REACH the provider; the fail-closed cases below
 *  are refused earlier, on the model, and say so. */
const PROVENANCE = { record: async () => 'ai-call-row' };

describe('AIService — model configuration', () => {
    const fetchMock = vi.fn();
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(new Response(
            JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 },
        ));
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    /** A real adapter over the mocked fetch, so these cases still assert what
     *  actually goes on the wire rather than what a stub was told to record. */
    const adapter = (model: string) => new OpenAiCompatibleProvider({
        apiKey: 'test-key', model, baseUrl: 'https://api.example.test/v1',
    });

    /** The JSON body of the first request the adapter sent. */
    const sentBody = () =>
        JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { model: string };

    const REWRITE_INPUT = {
        itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects' as const,
        originalComment: 'foo', instruction: 'shorten',
    };

    it('sends the configured model in the request body', async () => {
        const svc = new AIService({} as D1Database, 'test-key', 'saas', 'a-configured-model', undefined, OWN_CONFIRMED_KEY, PROVENANCE, undefined, adapter('a-configured-model'));
        await svc.rewriteComment(REWRITE_INPUT);
        expect(sentBody().model).toBe('a-configured-model');
    });

    it('carries no trace of the retired hardcoded pin', async () => {
        // Asserting the ABSENCE of the stale pin rather than the presence of a
        // specific model: pinning this to today's choice would make this test
        // the thing that has to be edited on every model upgrade.
        const svc = new AIService({} as D1Database, 'test-key', 'saas', 'some-other-model', undefined, OWN_CONFIRMED_KEY, PROVENANCE, undefined, adapter('some-other-model'));
        await svc.rewriteComment(REWRITE_INPUT);
        const req = JSON.stringify([fetchMock.mock.calls[0]![0], (fetchMock.mock.calls[0]![1] as RequestInit).body]);
        expect(req).not.toContain('gemini-1.5-flash');
    });

    it('fails closed — rewriteComment throws when no model is configured', async () => {
        const svc = new AIService({} as D1Database, 'test-key', 'saas', '');
        await expect(svc.rewriteComment(REWRITE_INPUT)).rejects.toThrow(/no AI model is configured/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails closed — suggestComment throws rather than degrading to an empty list', async () => {
        // suggestComment swallows RUNTIME failures into `[]`. A missing model is
        // a configuration failure, not a runtime one: it must reach the caller
        // as a 503 so the UI says "configure AI" instead of "no suggestions".
        const svc = new AIService({} as D1Database, 'test-key', 'saas', '');
        await expect(svc.suggestComment({ itemName: 'Roof', sectionName: 'Roof' }))
            .rejects.toThrow(/no AI model is configured/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails closed in standalone too — the dev mock never covers a missing model', async () => {
        // A self-hoster WITH a key but no model must get a clear error, not
        // `[DEV] ...` placeholder prose silently written into a real report.
        const svc = new AIService({} as D1Database, 'test-key', 'standalone', '');
        await expect(svc.rewriteComment(REWRITE_INPUT)).rejects.toThrow(/no AI model is configured/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails closed on the unguarded summary path as well', async () => {
        // Confirmed key on purpose. This path has no pre-check, so it reaches
        // the chokepoint where the capability gate runs BEFORE the adapter
        // validates the model — leaving the credential picture unconfirmed here
        // would make the case pass on the attestation refusal and stop saying
        // anything about a missing model.
        const svc = new AIService({} as D1Database, 'test-key', 'saas', '', undefined, OWN_CONFIRMED_KEY, PROVENANCE, undefined, adapter(''));
        await expect(svc.generateProfessionalComment('rough note'))
            .rejects.toThrow(/no AI model is configured/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still dev-mocks in standalone when there is no key at all', async () => {
        // Unchanged behavior: the local-development mock is gated on the KEY
        // being absent, and a missing model does not widen it.
        const svc = new AIService({} as D1Database, '', 'standalone', '');
        const out = await svc.rewriteComment(REWRITE_INPUT);
        expect(out.rewritten).toMatch(/^\[DEV\] /);
    });
});
