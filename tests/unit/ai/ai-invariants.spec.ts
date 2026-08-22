import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { posture, type AiOutputClassification } from '../../../server/lib/ai/output-classification';
import type { AiCredentialSource } from '../../../server/lib/ai/resolve-provider';
import { PROVIDER_REJECTED_MESSAGE } from '../../../server/lib/ai/providers/openai-compatible';
import { testAiConnection } from '../../../server/lib/ai/connection-test';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const CLASSES = [
    'translation', 'summary', 'finding_explanation',
    'maintenance_suggestion', 'legal_text', 'repair_pricing',
] as const satisfies readonly AiOutputClassification[];
const SOURCES = ['byo', 'managed'] as const satisfies readonly AiCredentialSource[];

/**
 * The constraints a later refactor could quietly remove without breaking a
 * single feature test. Each one is asserted against the SHIPPED artefact —
 * the public accessor, or the adapter source — rather than against a copy of
 * the rule kept in this file.
 */
/** Language that would diagnose a third party's commercial situation. */
const BANNED_DIAGNOSIS = /unpaid|payment required|overdue|past due/i;
/** A raw HTTP status reaching a message instead of the log. */
const STATUS_LEAK = /\b40[0-9]\b|\b429\b|\b5[0-9][0-9]\b/;

/** Every message `testAiConnection` can hand back, gathered by driving it
 *  through each failing status it distinguishes plus the transport throw. */
const COLLECTED_TEST_MESSAGES: string[] = [];

describe('AI invariants that no refactor may quietly remove', () => {
    beforeAll(async () => {
        const input = { baseUrl: 'https://api.example.test/v1', model: 'm', apiKey: 'k' };
        const original = globalThis.fetch;
        for (const status of [400, 401, 402, 403, 404, 429, 500, 503]) {
            globalThis.fetch = (async () => new Response('body', { status })) as typeof globalThis.fetch;
            const r = await testAiConnection(input);
            if (!r.ok) COLLECTED_TEST_MESSAGES.push(r.message);
        }
        globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof globalThis.fetch;
        const thrown = await testAiConnection(input);
        if (!thrown.ok) COLLECTED_TEST_MESSAGES.push(thrown.message);
        globalThis.fetch = original;
    });
    it('posture is answered from classification and source only — never from a provider', () => {
        // A provider axis would encode "this statement would be acceptable if a
        // different vendor generated it", which is backwards: where data may go
        // is an allow-list question, and what may be said is a posture
        // question. The arity of the accessor is the enforceable form of that.
        expect(posture.length).toBe(2);
    });

    it('answers for every classification on both sources, and refuses none by omission', () => {
        // The positive control for the two refusals below: a lookup that fell
        // through to undefined would make `allowed === false` true everywhere
        // and every negative assertion in this file meaningless.
        for (const cls of CLASSES) {
            for (const src of SOURCES) {
                const p = posture(cls, src);
                expect(p, `${cls}/${src}`).toBeDefined();
                expect(typeof p.allowed, `${cls}/${src}`).toBe('boolean');
            }
        }
        // And at least one pair really is allowed, or "refused on both sources"
        // below would be satisfied by a table that refuses everything.
        expect(CLASSES.some((cls) => SOURCES.some((src) => posture(cls, src).allowed))).toBe(true);
    });

    it('the two statements refused on both sources are still refused on both', () => {
        for (const cls of ['legal_text', 'repair_pricing'] as const) {
            expect(posture(cls, 'byo').allowed).toBe(false);
            expect(posture(cls, 'managed').allowed).toBe(false);
        }
    });

    it('the gateway path cannot be built without disabling payload logging', () => {
        const src = read('server/lib/ai/providers/openai-compatible.ts');
        expect(src).toContain('cf-aig-collect-log-payload');
    });

    it('no adapter logs an upstream response body', () => {
        // An error body can echo the request, and the request is inspection
        // text carrying client names and addresses.
        const src = read('server/lib/ai/providers/openai-compatible.ts');
        expect(src).not.toMatch(/logger\.(error|warn|info)\([^)]*await res\.text\(\)/);
        expect(src).not.toMatch(/logger\.\w+\([^)]*\{\s*response\s*:/);
    });

    it('the connection test does not return the provider body either', () => {
        const src = read('server/lib/ai/connection-test.ts');
        expect(src).not.toMatch(/await res\.text\(\)/);
    });

    it('no message a workspace reads diagnoses the provider commercial reason', () => {
        // 402 is a number this codebase did not author, so no message may turn
        // it into a finding about someone else's business relationship.
        //
        // ASSERTED ON THE VALUES, NOT THE SOURCE TEXT, and the first draft of
        // this test taught the lesson: a grep over the file failed on the
        // COMMENT that explains the rule, because explaining "never say an
        // account is unpaid" requires writing the words down. A source-text
        // gate cannot tell a prohibition from its own explanation. The values
        // below are what actually reaches a person.
        expect(PROVIDER_REJECTED_MESSAGE).not.toMatch(BANNED_DIAGNOSIS);
        expect(PROVIDER_REJECTED_MESSAGE).not.toMatch(STATUS_LEAK);
        // And it is still the one sentence, so a rewrite that emptied it does
        // not pass here by saying nothing at all.
        expect(PROVIDER_REJECTED_MESSAGE).toMatch(/check your api key/i);
    });

    it('every connection-test message is clean of both, on every failing status', () => {
        // The exhaustive form of the case above, across every branch a
        // workspace can actually reach. Collected by driving the function
        // rather than copied, so a new branch is covered the day it is added.
        expect(COLLECTED_TEST_MESSAGES.length).toBeGreaterThan(0);
        for (const msg of COLLECTED_TEST_MESSAGES) {
            expect(msg, msg).not.toMatch(BANNED_DIAGNOSIS);
            expect(msg, msg).not.toMatch(STATUS_LEAK);
        }
    });

    it('the native Gemini adapter is gone and nothing imports it', () => {
        expect(existsSync(join(ROOT, 'server/lib/ai/providers/gemini.ts'))).toBe(false);
        for (const f of [
            'server/lib/ai/resolve-provider.ts',
            'server/lib/ai/build-ai-service.ts',
            'server/services/ai.service.ts',
        ]) {
            expect(read(f), f).not.toContain('GeminiProvider');
        }
    });

    it('the resolver is the only module that constructs an adapter', () => {
        // The seam Task 6 exists to create. A service that built its own would
        // be a second answer to which backend an inspector's text reaches, and
        // the first symptom would be a managed call running on nobody's key.
        expect(read('server/services/ai.service.ts')).not.toContain('new OpenAiCompatibleProvider');
        expect(read('server/lib/ai/resolve-provider.ts')).toContain('new OpenAiCompatibleProvider');
    });
});
