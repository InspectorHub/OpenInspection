import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIService } from '../../src/services/ai.service';

/**
 * Spec 5B P2B — AIService.rewriteComment unit tests.
 *
 * Gemini's HTTP API is mocked via global fetch so we can assert the prompt
 * shape (context, instruction) and verify the trim / quote-strip behavior.
 */
describe('Spec 5B P2B — AIService.rewriteComment', () => {
    const fetchMock = vi.fn();
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        fetchMock.mockReset();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function mockGeminiOK(text: string) {
        fetchMock.mockResolvedValueOnce({
            ok:   true,
            json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
        } as Response);
    }

    it('throws AINotConfigured when GEMINI_API_KEY is not configured (saas mode)', async () => {
        // Sprint 1 A-4: explicit appMode='saas' so the dev-mock path is skipped.
        const svc = new AIService({} as D1Database, '', 'saas');
        await expect(svc.rewriteComment({
            itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'foo', instruction: 'shorten',
        })).rejects.toThrow(/AI is not configured/i);
    });

    it('returns dev-mock rewrite in standalone mode without API key', async () => {
        const svc = new AIService({} as D1Database, '', 'standalone');
        const out = await svc.rewriteComment({
            itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'Old text', instruction: 'shorten',
        });
        expect(out).toMatch(/^\[DEV\] /);
        expect(out).toContain('Old text');
    });

    it('returns the rewritten text with surrounding quotes stripped', async () => {
        mockGeminiOK('"Major cracking observed at NW corner; recommend evaluation."');
        const svc = new AIService({} as D1Database, 'test-key');
        const out = await svc.rewriteComment({
            itemLabel: 'Roof Covering', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'Cracks observed.', instruction: 'add NW corner detail',
            category: 'safety', location: 'NW corner',
        });
        expect(out).toBe('Major cracking observed at NW corner; recommend evaluation.');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('includes item / section / tab / category / location in the prompt', async () => {
        mockGeminiOK('rewritten body');
        const svc = new AIService({} as D1Database, 'test-key');
        await svc.rewriteComment({
            itemLabel:       'Roof Covering',
            sectionTitle:    'Roof',
            tab:             'defects',
            originalComment: 'baseline',
            instruction:     'be more specific',
            category:        'safety',
            location:        'Northwest corner',
        });
        const [, init] = fetchMock.mock.calls[0]!;
        const body = JSON.parse((init as RequestInit).body as string);
        const prompt = body.contents[0].parts[0].text as string;
        expect(prompt).toContain('Roof Covering');
        expect(prompt).toContain('Section: "Roof"');
        expect(prompt).toContain('Tab: defects');
        expect(prompt).toContain('Defect category: safety');
        expect(prompt).toContain('Location: Northwest corner');
        expect(prompt).toContain('be more specific');
        expect(prompt).toContain('baseline');
    });

    it('omits defect-only context fields when tab is not "defects"', async () => {
        mockGeminiOK('rewritten');
        const svc = new AIService({} as D1Database, 'test-key');
        await svc.rewriteComment({
            itemLabel:       'Inspection Method',
            sectionTitle:    'Roof',
            tab:             'limitations',
            originalComment: 'Walked the roof.',
            instruction:     'professional tone',
        });
        const [, init] = fetchMock.mock.calls[0]!;
        const body = JSON.parse((init as RequestInit).body as string);
        const prompt = body.contents[0].parts[0].text as string;
        expect(prompt).not.toContain('Defect category');
        expect(prompt).not.toContain('Location:');
        expect(prompt).toContain('Tab: limitations');
    });

    it('throws on Gemini error responses', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, text: async () => 'rate limited' } as Response);
        const svc = new AIService({} as D1Database, 'test-key');
        await expect(svc.rewriteComment({
            itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'foo', instruction: 'shorten',
        })).rejects.toThrow(/Failed to generate content/i);
    });
});
