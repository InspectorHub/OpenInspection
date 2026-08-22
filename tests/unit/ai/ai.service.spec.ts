import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIService } from '../../../server/services/ai.service';
import { RecordingAiProvider } from '../../../server/lib/ai/providers/recording';
import { Errors, ErrorCode } from '../../../server/lib/errors';
import { AI_REFUSAL_REASON } from '../../../server/lib/ai/refusal-reason';

/**
 * AIService.rewriteComment unit tests.
 *
 * The backend is a RECORDING PROVIDER, not a stubbed global `fetch`. These
 * cases are about what the service ASKS FOR and what it does with the answer;
 * the HTTP shape it travels over belongs to the adapter and is asserted in
 * `openai-compatible.spec.ts`. Stubbing fetch here made every one of these
 * cases quietly depend on one vendor's request envelope, which is exactly the
 * coupling the provider seam exists to remove.
 */
/**
 * The only credential picture that reaches a provider: the tenant's own key,
 * with a confirmation on file. Spelled out at each construction rather than
 * defaulted, because the service's default is fail-closed — a case that forgot
 * to say this would be refused by the capability gate, not quietly allowed.
 */
const OWN_CONFIRMED_KEY = { source: 'byo', tenantKeyAttested: true } as const;
/** The chokepoint records every call and refuses to run when it cannot, so a
 *  construction that reaches a provider must supply a sink. What it writes is
 *  covered in `provenance.spec.ts`; here it only has to exist. */
const PROVENANCE = { record: async () => 'ai-call-row' };

describe('AIService.rewriteComment', () => {
    let recorder: RecordingAiProvider;

    beforeEach(() => { recorder = new RecordingAiProvider(['']); });

    /** A service wired to `recorder`, replying with `text`. */
    const withReply = (text: string) => {
        recorder = new RecordingAiProvider([text]);
        return new AIService(
            {} as D1Database, 'test-key', 'saas', 'test-model', undefined,
            OWN_CONFIRMED_KEY, PROVENANCE, undefined, recorder,
        );
    };

    /** The prompt the service actually sent, for the context assertions. */
    const sentPrompt = () => recorder.requests[0]!.prompt;

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
        expect(out.rewritten).toMatch(/^\[DEV\] /);
        expect(out.rewritten).toContain('Old text');
        // No model ran, so there is no call to cite. A dev mock that arrived
        // with a provenance id would be citable as reviewed model output.
        expect(out.aiCallId).toBeNull();
    });

    it('returns the rewritten text with surrounding quotes stripped', async () => {
        const svc = withReply('"Major cracking observed at NW corner; recommend evaluation."');
        const out = await svc.rewriteComment({
            itemLabel: 'Roof Covering', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'Cracks observed.', instruction: 'add NW corner detail',
            category: 'safety', location: 'NW corner',
        });
        expect(out.rewritten).toBe('Major cracking observed at NW corner; recommend evaluation.');
        expect(out.aiCallId).toBe('ai-call-row');
        expect(recorder.requests).toHaveLength(1);
    });

    it('includes item / section / tab / category / location in the prompt', async () => {
        const svc = withReply('rewritten body');
        await svc.rewriteComment({
            itemLabel:       'Roof Covering',
            sectionTitle:    'Roof',
            tab:             'defects',
            originalComment: 'baseline',
            instruction:     'be more specific',
            category:        'safety',
            location:        'Northwest corner',
        });
        const prompt = sentPrompt();
        expect(prompt).toContain('Roof Covering');
        expect(prompt).toContain('Section: "Roof"');
        expect(prompt).toContain('Tab: defects');
        expect(prompt).toContain('Defect category: safety');
        expect(prompt).toContain('Location: Northwest corner');
        expect(prompt).toContain('be more specific');
        expect(prompt).toContain('baseline');
    });

    it('omits defect-only context fields when tab is not "defects"', async () => {
        const svc = withReply('rewritten');
        await svc.rewriteComment({
            itemLabel:       'Inspection Method',
            sectionTitle:    'Roof',
            tab:             'limitations',
            originalComment: 'Walked the roof.',
            instruction:     'professional tone',
        });
        const prompt = sentPrompt();
        expect(prompt).not.toContain('Defect category');
        expect(prompt).not.toContain('Location:');
        expect(prompt).toContain('Tab: limitations');
    });

    it('surfaces a provider failure rather than returning placeholder prose', async () => {
        // rewriteComment has no degrade arm on purpose: silently overwriting
        // the inspector's own text with something a model did not produce is
        // worse than an error toast. WHICH statuses become which kind of
        // failure is the adapter's decision, asserted in its own spec.
        const svc = new AIService(
            {} as D1Database, 'test-key', 'saas', 'test-model', undefined,
            OWN_CONFIRMED_KEY, PROVENANCE, undefined,
            { id: 'x', complete: async () => { throw new Error('Failed to generate content from AI'); } },
        );
        await expect(svc.rewriteComment({
            itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'foo', instruction: 'shorten',
        })).rejects.toThrow(/Failed to generate content/i);
    });
});

/**
 * WHICH FAILURES REACH THE INSPECTOR, AND WHICH ONES DEGRADE.
 *
 * `suggestComment` turns a runtime failure into an empty list on purpose — a
 * model that timed out has nothing to say and the inspector can carry on
 * typing. A REFUSAL is the opposite: somebody has to act, and an empty popover
 * reads as "the model had no ideas" to the one person who could have fixed it.
 */
describe('suggestComment — refusals reach the inspector, failures degrade', () => {
    /** An AiService whose provider always throws `err`, with the ledger stubbed
     *  so the test observes only the failure classification. */
    const serviceWhoseProviderThrows = (err: unknown) => new AIService(
        {} as D1Database,
        'test-key',
        'saas',
        'test-model',
        undefined,
        OWN_CONFIRMED_KEY,
        PROVENANCE,
        undefined,
        { id: 'test', complete: async () => { throw err; } },
    );

    it('re-throws an upstream credential refusal instead of returning no suggestions', async () => {
        // The case this whole change is about: on a workspace's own key it is
        // THEIR provider account, only they can fix it, and "no suggestions"
        // tells them nothing at all.
        const svc = serviceWhoseProviderThrows(
            Errors.AINotConfigured('rejected', AI_REFUSAL_REASON.UPSTREAM_CREDENTIAL),
        );
        const err = await svc.suggestComment({ itemName: 'Roof', sectionName: 'Exterior' }).catch(e => e);
        expect(err.code).toBe(ErrorCode.AI_NOT_CONFIGURED);
        expect(err.details).toEqual({ reason: 'upstream_credential' });
    });

    it('still degrades a plain runtime failure to an empty list', async () => {
        // The positive control: without this case, a service that re-threw
        // EVERYTHING would pass the assertion above.
        const svc = serviceWhoseProviderThrows(new Error('socket hang up'));
        expect(await svc.suggestComment({ itemName: 'Roof', sectionName: 'Exterior' }))
            .toEqual({ suggestions: [], aiCallId: null });
    });

    it('calls the provider it was given, and constructs none of its own', async () => {
        // The whole point of Task 6: credential and endpoint selection belongs
        // to the resolver. A service that built its own adapter would never see
        // this stub, and would reach a real network instead.
        const calls: string[] = [];
        const svc = new AIService(
            {} as D1Database, 'test-key', 'saas', 'test-model', undefined,
            OWN_CONFIRMED_KEY, PROVENANCE, undefined,
            { id: 'injected', complete: async (r) => { calls.push(r.prompt); return { text: '["a"]' }; } },
        );
        const out = await svc.suggestComment({ itemName: 'Roof', sectionName: 'Exterior' });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('Roof');
        expect(out.suggestions).toEqual(['a']);
    });

    it('refuses rather than running when no provider was resolved', async () => {
        // Fail closed. A service handed no provider has had no credential
        // decision made for it, and inventing one here would be a second
        // answer to a question `resolve-provider.ts` owns.
        const svc = new AIService(
            {} as D1Database, 'test-key', 'saas', 'test-model', undefined,
            OWN_CONFIRMED_KEY, PROVENANCE,
        );
        const err = await svc.suggestComment({ itemName: 'Roof', sectionName: 'Exterior' }).catch(e => e);
        expect(err.code).toBe(ErrorCode.AI_NOT_CONFIGURED);
    });
});
