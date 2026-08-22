/**
 * Deriving a template's structure from text, and the two things that decide
 * whether it may run at all.
 *
 * ⚠️ THIS CAPABILITY IS NOT RELEASED, ON ANY CREDENTIALS, and the assertions
 * below are the record of that rather than a temporary state to be edited past.
 * A green suite is not clearance: what releases a capability in this codebase
 * is an edit to the posture table, reviewed as the product decision it is.
 *
 * The tests come in pairs on purpose. A refusal test alone passes for a gate
 * that refuses everything, which is the shape that would silently take a
 * released feature down with it — so every refusal here is paired with a
 * capability that IS released on the same credentials.
 */
import { describe, it, expect } from 'vitest';
import { AI_PROMPTS } from '../../../server/lib/ai/prompts';
import { checkAiCapability } from '../../../server/lib/ai/capability-policy';
import type { AiCredentialSource } from '../../../server/lib/ai/resolve-provider';
import { buildInferenceRequest } from '../../../server/lib/migration-intake/infer-template';

const PAGES = ['Roof', 'Covering', 'Comments'];
const EVERY_SOURCE: readonly AiCredentialSource[] = ['managed', 'byo'];

describe('the outgoing request', () => {
    it('sends TEXT only — the request gains no binary or multimodal field', () => {
        const req = buildInferenceRequest(PAGES);
        expect(Object.keys(req)).toEqual(expect.arrayContaining(['prompt']));
        expect(Object.keys(req)).not.toContain('parts');
        expect(Object.keys(req)).not.toContain('inlineData');
        expect(typeof req.prompt).toBe('string');
    });

    it('carries no field whose value is not a string or a number', () => {
        // The assertion above names the two field names a multimodal payload
        // has used. This one does not have to know their names: bytes cannot
        // travel through this request in any field, however it is spelled.
        for (const value of Object.values(buildInferenceRequest(PAGES))) {
            expect(['string', 'number', 'undefined']).toContain(typeof value);
        }
    });

    it('the outgoing prompt contains no personal information', () => {
        const req = buildInferenceRequest(PAGES);
        expect(req.prompt).not.toMatch(/@|\d{3}[- ]\d{4}|Street/);
    });

    it('POSITIVE CONTROL — a page that DOES carry personal information makes that assertion fail', () => {
        // Without this, the assertion above passes for a builder that sends an
        // empty prompt, which is exactly what a broken extractor produces.
        // …and it is why the scan runs BEFORE this is ever called: this
        // function has no opinion about what is in the pages it was handed.
        const req = buildInferenceRequest(['Prepared for zoe@example.test']);
        expect(req.prompt).toMatch(/@/);
    });

    it('includes every page it was given', () => {
        const req = buildInferenceRequest(['Alpha', 'Bravo', 'Charlie']);
        for (const page of ['Alpha', 'Bravo', 'Charlie']) expect(req.prompt).toContain(page);
    });

    it('renders through the versioned prompt, not a second copy of the text', () => {
        // Two renderers for one capability is how a stored `prompt_version`
        // stops naming the words that were actually sent.
        expect(buildInferenceRequest(PAGES).prompt)
            .toBe(AI_PROMPTS.templateInference.render({ pages: PAGES }));
    });
});

describe('the prompt', () => {
    it('is versioned', () => {
        expect(AI_PROMPTS.templateInference.version).toBe('template-inference.v1');
    });

    it('says what kind of output it produces', () => {
        expect(AI_PROMPTS.templateInference.classification).toBe('template_inference');
    });
});

describe('whether it may run', () => {
    it('is refused on the platform key, and the refusal names the credentials', () => {
        const decision = checkAiCapability('template_inference', {
            source: 'managed',
            tenantKeyAttested: false,
        });
        expect(decision.allowed).toBe(false);
        if (decision.allowed) return;
        expect(decision.reason).toBe('source_not_offered');
    });

    it('is refused on a workspace own key as well, because it is not released', () => {
        const decision = checkAiCapability('template_inference', {
            source: 'byo',
            tenantKeyAttested: true,
        });
        expect(decision.allowed).toBe(false);
        if (decision.allowed) return;
        expect(decision.reason).toBe('capability_not_released');
    });

    it('is refused on EVERY credential source there is', () => {
        // Total over the union rather than over the two cases above, so a
        // third credential source added later cannot quietly release this.
        for (const source of EVERY_SOURCE) {
            expect(checkAiCapability('template_inference', { source, tenantKeyAttested: true }).allowed)
                .toBe(false);
        }
    });

    it('POSITIVE CONTROL — a released capability on the same credentials is allowed', () => {
        // Without this, every refusal above passes for a gate that refuses
        // everything — which would take the released features down with it and
        // look, from this file, exactly like success.
        expect(checkAiCapability('translation', { source: 'byo', tenantKeyAttested: true }).allowed)
            .toBe(true);
    });

    it('POSITIVE CONTROL — the refusal reasons are distinguishable from each other', () => {
        // `source_not_offered` and `capability_not_released` mean different
        // things to the person reading the message: one names credentials they
        // could change, the other names a feature that does not ship. A gate
        // collapsing them would still refuse, and would tell people to go and
        // configure something that would not help.
        const managed = checkAiCapability('template_inference', { source: 'managed', tenantKeyAttested: false });
        const byo = checkAiCapability('template_inference', { source: 'byo', tenantKeyAttested: true });
        if (managed.allowed || byo.allowed) throw new Error('expected both to be refused');
        expect(managed.reason).not.toBe(byo.reason);
        expect(managed.message).not.toBe(byo.message);
    });
});
