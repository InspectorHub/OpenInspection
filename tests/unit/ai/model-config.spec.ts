import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIService } from '../../../server/services/ai.service';

/**
 * The AI model is configuration, not a source-code constant.
 *
 * The request URL used to hardcode `gemini-1.5-flash`, so every AI feature was
 * quality-capped at one model with no way to change it. The model now arrives
 * as configuration, and — like every other credential/endpoint in this repo —
 * there is NO baked-in fallback: an unconfigured model fails closed.
 *
 * The fail-closed cases are the load-bearing ones. A suite that only exercises
 * the configured path passes just as happily against a hardcoded default, which
 * is exactly the bug this file exists to prevent.
 */
/** The tenant's own key with a confirmation on file — the capability gate
 *  refuses anything else, and the service defaults to fail-closed. */
const OWN_CONFIRMED_KEY = { source: 'byo', tenantKeyAttested: true } as const;

describe('AIService — model configuration', () => {
    const fetchMock = vi.fn();
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        fetchMock.mockReset();
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
        } as Response);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    const REWRITE_INPUT = {
        itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects' as const,
        originalComment: 'foo', instruction: 'shorten',
    };

    it('sends the configured model in the request URL', async () => {
        const svc = new AIService({} as D1Database, 'test-key', 'saas', 'gemini-3.1-flash-lite', undefined, OWN_CONFIRMED_KEY);
        await svc.rewriteComment(REWRITE_INPUT);
        expect(String(fetchMock.mock.calls[0]![0])).toContain('gemini-3.1-flash-lite');
    });

    it('carries no trace of the retired hardcoded pin', async () => {
        // Asserting the ABSENCE of the stale pin rather than the presence of a
        // specific model: pinning this to today's choice would make this test
        // the thing that has to be edited on every model upgrade.
        const svc = new AIService({} as D1Database, 'test-key', 'saas', 'some-other-model', undefined, OWN_CONFIRMED_KEY);
        await svc.rewriteComment(REWRITE_INPUT);
        expect(String(fetchMock.mock.calls[0]![0])).not.toContain('gemini-1.5-flash');
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
        const svc = new AIService({} as D1Database, 'test-key', 'saas', '', undefined, OWN_CONFIRMED_KEY);
        await expect(svc.generateProfessionalComment('rough note'))
            .rejects.toThrow(/no AI model is configured/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still dev-mocks in standalone when there is no key at all', async () => {
        // Unchanged behavior: the local-development mock is gated on the KEY
        // being absent, and a missing model does not widen it.
        const svc = new AIService({} as D1Database, '', 'standalone', '');
        const out = await svc.rewriteComment(REWRITE_INPUT);
        expect(out).toMatch(/^\[DEV\] /);
    });
});
