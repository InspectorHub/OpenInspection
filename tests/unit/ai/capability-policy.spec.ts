import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    checkAiCapability,
    type AiCapabilityDecision,
    type AiCapabilityDenialReason,
} from '../../../server/lib/ai/capability-policy';
import { AIService } from '../../../server/services/ai.service';

/**
 * The capability gate: whether the product OFFERS a given AI capability on a
 * given set of credentials, asked at the one chokepoint every AI feature runs
 * through.
 *
 * The gate is behavior-neutral today — no deployment has a platform key, so no
 * call resolves to 'managed'. That is exactly why it needs tests: nothing in a
 * running system would notice if it stopped working, and the day it matters is
 * the day someone provisions the key.
 */
/** Narrow to the denial arm, so a case reads `reason` without a cast and a
 *  decision that unexpectedly ALLOWS fails here rather than silently comparing
 *  `undefined` against the expected reason. */
function denialReason(d: AiCapabilityDecision): AiCapabilityDenialReason {
    if (d.allowed) throw new Error('expected a denial, got an allow');
    return d.reason;
}

describe('AI capability policy', () => {
    it('offers assist on the tenant OWN key', () => {
        expect(checkAiCapability('assist', 'byo')).toEqual({ allowed: true });
    });

    it('does NOT offer assist on platform credentials', () => {
        const d = checkAiCapability('assist', 'managed');
        expect(d).toMatchObject({ allowed: false, capability: 'assist', source: 'managed' });
        expect(denialReason(d)).toBe('source_not_offered');
    });

    it('does NOT offer translate on ANY credentials — including the tenant own key', () => {
        // Asserted on BYO first: if this only covered 'managed' it would pass
        // against a policy that refuses nothing but managed, which is a
        // different rule with the same green.
        const byo = checkAiCapability('translate', 'byo');
        expect(byo).toMatchObject({ allowed: false, source: 'byo' });
        expect(denialReason(byo)).toBe('capability_not_released');
        expect(denialReason(checkAiCapability('translate', 'managed'))).toBe('capability_not_released');
    });
});

describe('the gate at the AI chokepoint', () => {
    const fetchMock = vi.fn();
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        fetchMock.mockReset();
        // Every case below arms a SUCCESSFUL model response, so nothing passes
        // because the call would have failed anyway.
        fetchMock.mockResolvedValue({
            ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }),
        } as Response);
    });
    afterEach(() => { globalThis.fetch = originalFetch; });

    function service(source: 'byo' | 'managed', record: () => Promise<void>) {
        return new AIService({} as D1Database, 'a-key', 'saas', 'a-model', { record }, source);
    }

    it('a refused call records NO usage and sends nothing', async () => {
        // The tenant consumed nothing, so there is nothing to meter. The gate
        // sits ahead of the provider call and the meter sits behind it, which
        // is what makes that true without a second branch.
        const record = vi.fn(async () => {});
        await expect(service('managed', record).generateProfessionalComment('note'))
            .rejects.toMatchObject({ status: 503, code: 'ai_not_configured' });
        expect(record).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('the SAME call on the tenant own key still runs and still meters', async () => {
        // The control. Without it, "record was not called" proves nothing —
        // a meter that never fires at all would satisfy the case above.
        const record = vi.fn(async () => {});
        await expect(service('byo', record).generateProfessionalComment('note')).resolves.toBe('x');
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith('assist');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('a refusal reaches suggestComment callers instead of degrading to no suggestions', async () => {
        // suggestComment swallows RUNTIME failures into an empty list. A
        // capability the product does not offer must not arrive looking like
        // the model had nothing to say.
        const record = vi.fn(async () => {});
        await expect(service('managed', record).suggestComment({ itemName: 'Roof', sectionName: 'Roof' }))
            .rejects.toMatchObject({ code: 'ai_not_configured' });
        expect(record).not.toHaveBeenCalled();
    });
});
