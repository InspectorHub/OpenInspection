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

/** The tenant's own key, with a confirmation on file. */
const OWN_CONFIRMED_KEY = { source: 'byo', tenantKeyAttested: true } as const;
/** The same key, with nothing on file about the provider account behind it. */
const OWN_UNCONFIRMED_KEY = { source: 'byo', tenantKeyAttested: false } as const;
/** Platform credentials. The confirmation is about the WORKSPACE's own provider
 *  account, so it has no meaning here — set false to prove the managed refusal
 *  does not secretly depend on it. */
const MANAGED = { source: 'managed', tenantKeyAttested: false } as const;

describe('AI capability policy', () => {
    it('offers assist on the tenant OWN key', () => {
        expect(checkAiCapability('assist', OWN_CONFIRMED_KEY)).toEqual({ allowed: true });
    });

    it('does NOT offer assist on platform credentials', () => {
        const d = checkAiCapability('assist', MANAGED);
        expect(d).toMatchObject({ allowed: false, capability: 'assist', source: 'managed' });
        expect(denialReason(d)).toBe('source_not_offered');
    });

    it('does NOT offer translate on ANY credentials — including the tenant own key', () => {
        // Asserted on BYO first: if this only covered 'managed' it would pass
        // against a policy that refuses nothing but managed, which is a
        // different rule with the same green.
        const byo = checkAiCapability('translate', OWN_CONFIRMED_KEY);
        expect(byo).toMatchObject({ allowed: false, source: 'byo' });
        expect(denialReason(byo)).toBe('capability_not_released');
        expect(denialReason(checkAiCapability('translate', MANAGED))).toBe('capability_not_released');
    });

    it('does NOT offer assist on an own key with no confirmation on file', () => {
        // The save gate only covers keys stored after it existed. A key that
        // predates it has been confirmed against nothing, and this is the only
        // gate that is true of it.
        const d = checkAiCapability('assist', OWN_UNCONFIRMED_KEY);
        expect(d).toMatchObject({ allowed: false, capability: 'assist', source: 'byo' });
        expect(denialReason(d)).toBe('tenant_key_not_attested');
    });

    it('tells the reader where to go and what to do there', () => {
        // A refusal a workspace cannot act on is an outage with extra steps:
        // their key is present and valid, so "AI is unavailable" explains
        // nothing. The message must name the destination and the action.
        const d = checkAiCapability('assist', OWN_UNCONFIRMED_KEY);
        if (d.allowed) throw new Error('expected a denial');
        expect(d.message).toContain('Settings → Advanced → AI');
        expect(d.message).toMatch(/confirm/i);
    });

    it('keeps the unconfirmed refusal distinct from the not-released one', () => {
        // Same call, two different reasons depending on the capability. If
        // translate reported `tenant_key_not_attested`, confirming would look
        // like it should unlock a feature that does not exist.
        expect(denialReason(checkAiCapability('translate', OWN_UNCONFIRMED_KEY)))
            .toBe('capability_not_released');
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

    /** The provenance sink every construction gets. Its own behaviour is
     *  covered in `provenance.spec.ts`; here it exists because the chokepoint
     *  refuses to run without one, so a case that omitted it would pass on the
     *  wrong refusal. */
    const provenance = { record: async () => {} };

    function service(
        credentials: { source: 'byo' | 'managed'; tenantKeyAttested: boolean },
        record: () => Promise<void>,
    ) {
        return new AIService({} as D1Database, 'a-key', 'saas', 'a-model', { record }, credentials, provenance);
    }

    it('a refused call records NO usage and sends nothing', async () => {
        // The tenant consumed nothing, so there is nothing to meter. The gate
        // sits ahead of the provider call and the meter sits behind it, which
        // is what makes that true without a second branch.
        const record = vi.fn(async () => {});
        await expect(service(MANAGED, record).generateProfessionalComment('note'))
            .rejects.toMatchObject({ status: 503, code: 'ai_not_configured' });
        expect(record).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('the SAME call on the tenant own key still runs and still meters', async () => {
        // The control. Without it, "record was not called" proves nothing —
        // a meter that never fires at all would satisfy the case above.
        const record = vi.fn(async () => {});
        await expect(service(OWN_CONFIRMED_KEY, record).generateProfessionalComment('note')).resolves.toBe('x');
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith('assist');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('an unconfirmed own key sends nothing to the provider and meters nothing', async () => {
        // The point of the runtime gate: the credential is present and would
        // work. Nothing may leave the process on it until a confirmation exists,
        // so the assertion is on the ABSENCE of the outbound call, not on the
        // thrown error alone — an implementation that called Gemini and then
        // discarded the result would satisfy a rejects-only test.
        const record = vi.fn(async () => {});
        await expect(service(OWN_UNCONFIRMED_KEY, record).generateProfessionalComment('note'))
            .rejects.toMatchObject({ status: 503, code: 'ai_not_configured' });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('a construction that says nothing about the confirmation is refused', async () => {
        // Fail-closed default. A future call site that forgets the credential
        // picture must not inherit an open gate — the failure mode where a gate
        // treats "declared nothing" as "declared compliant".
        const svc = new AIService({} as D1Database, 'a-key', 'saas', 'a-model');
        await expect(svc.generateProfessionalComment('note'))
            .rejects.toMatchObject({ code: 'ai_not_configured' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a refusal reaches suggestComment callers instead of degrading to no suggestions', async () => {
        // suggestComment swallows RUNTIME failures into an empty list. A
        // capability the product does not offer must not arrive looking like
        // the model had nothing to say.
        const record = vi.fn(async () => {});
        await expect(service(MANAGED, record).suggestComment({ itemName: 'Roof', sectionName: 'Roof' }))
            .rejects.toMatchObject({ code: 'ai_not_configured' });
        expect(record).not.toHaveBeenCalled();
    });
});
