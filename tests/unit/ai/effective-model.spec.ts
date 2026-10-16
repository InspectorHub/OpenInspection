/**
 * The model a call runs on is the model of the provider `resolveAi` selected,
 * not whatever the deployment environment happens to hold.
 *
 * These cases go through `buildTenantAiService` on purpose: the defect lived in
 * the seam between the resolver (which already preferred the company's model)
 * and the service (which checked only the deployment's). A spec that built the
 * pieces by hand would agree with itself and miss it.
 *
 * Every refusal below is paired with a control that is allowed to proceed under
 * the same setup with one input changed, so an empty result cannot read as a
 * pass.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { buildTenantAiService } from '../../../server/lib/ai/build-ai-service';
import { OpenAiCompatibleProvider } from '../../../server/lib/ai/providers/openai-compatible';
import { resolveAi, isRefusal } from '../../../server/lib/ai/resolve-provider';
import { assertProviderConfigured, unknownModelRefusal } from '../../../server/lib/ai/configuration-gap';
import { isPaidPlan } from '../../../server/features/plan-quota/policy';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';
import { logger } from '../../../server/lib/logger';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 'tenant-effective-model';
const COMPANY_URL = 'https://company.example.test/v1';
const ENV_URL = 'https://deployment.example.test/v1';
const PROMPT_ARGS = { itemName: 'Roof', sectionName: 'Roof' };

let db: BetterSQLite3Database<typeof schema>;
const fetchMock = vi.fn();
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    vi.mocked(mockDrizzle).mockReturnValue(db as never);
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(
        JSON.stringify({ choices: [{ message: { content: '["a","b","c"]' } }] }), { status: 200 },
    ));
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

const rows = () => db.select().from(schema.aiCallProvenance).all();
const sentModel = () =>
    (JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { model: string }).model;

type Over = Partial<Parameters<typeof buildTenantAiService>[0]>;
/** An own-key company, key confirmed, nothing configured anywhere else. */
const build = (over: Over = {}) => buildTenantAiService({
    db: {} as D1Database,
    profile: STANDALONE_PROFILE,
    tenantId: TENANT,
    tenantKey: 'company-key',
    managedKey: null,
    model: '',
    plan: null,
    tenantKeyAttested: true,
    quotaGuard: undefined,
    aiEnabled: true,
    tenantBaseUrl: null,
    tenantModel: null,
    baseUrl: '',
    ...over,
});

describe('own key: the company model is the effective model', () => {
    it('runs on the company model, endpoint and key when the deployment sets none', async () => {
        const svc = build({ tenantModel: 'company-model', tenantBaseUrl: COMPANY_URL });
        const out = await svc.suggestComment(PROMPT_ARGS);

        expect(out.suggestions).toEqual(['a', 'b', 'c']);
        expect(sentModel()).toBe('company-model');
        expect(String(fetchMock.mock.calls[0]![0])).toBe(`${COMPANY_URL}/chat/completions`);
    });

    it('records the model that was used, not the deployment one', async () => {
        const svc = build({ model: 'env-model', baseUrl: ENV_URL, tenantModel: 'company-model', tenantBaseUrl: COMPANY_URL });
        await svc.generateProfessionalComment('rough note');

        expect(sentModel()).toBe('company-model');
        expect(rows()).toHaveLength(1);
        expect(rows()[0]!.model).toBe('company-model');
    });

    it('falls back to the deployment model only when the company model is empty', async () => {
        const svc = build({ model: 'env-model', baseUrl: ENV_URL });
        await svc.generateProfessionalComment('rough note');

        expect(sentModel()).toBe('env-model');
        expect(rows()[0]!.model).toBe('env-model');
    });
});

describe('own key: an empty effective model fails closed before anything is sent or recorded', () => {
    it('refuses with the stable code and tells the company which field to fill in', async () => {
        const svc = build({ tenantBaseUrl: COMPANY_URL });
        const err = await svc.generateProfessionalComment('rough note').catch((e: unknown) => e);

        expect(err).toMatchObject({
            status: 503,
            code: 'ai_not_configured',
            message: 'Your AI account needs a model name. Add one in Settings → Advanced → AI.',
        });
        expect(String((err as Error).message)).not.toMatch(/AI_MODEL|environment|deployment/i);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(0);
    });

    it('keeps the environment hint for the operator in the log, not in the message', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        await build({ tenantBaseUrl: COMPANY_URL }).rewriteComment({
            itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects', originalComment: 'x', instruction: 'shorten',
        }).catch(() => {});

        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls[0])).toContain('AI_MODEL');
    });

    it('does not let suggestComment turn the refusal into an empty list', async () => {
        await expect(build({ tenantBaseUrl: COMPANY_URL }).suggestComment(PROMPT_ARGS))
            .rejects.toMatchObject({ code: 'ai_not_configured' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a company model with no endpoint anywhere, and sends nothing', async () => {
        const svc = build({ tenantModel: 'company-model' });
        const err = await svc.generateProfessionalComment('rough note').catch((e: unknown) => e);

        expect(err).toMatchObject({
            status: 503,
            code: 'ai_not_configured',
            message: 'Your AI account needs an endpoint address. Add one in Settings → Advanced → AI.',
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(rows()).toHaveLength(0);
    });

    it('the same company with an endpoint is not refused', async () => {
        await build({ tenantModel: 'company-model', tenantBaseUrl: COMPANY_URL }).generateProfessionalComment('rough note');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('provided path: only the deployment model is ever read', () => {
    const PAID = { tier: 'pro', status: 'active' } as const;
    const resolveProvided = (over: Partial<Parameters<typeof resolveAi>[0]> = {}) => resolveAi({
        profile: SAAS_PROFILE, aiEnabled: true, tenantKey: null, managedKey: 'platform-key',
        managedEntitled: isPaidPlan(PAID), underCap: true, defaultBaseUrl: ENV_URL,
        tenantModel: 'company-model', tenantBaseUrl: COMPANY_URL, model: '', ...over,
    });

    it('does not take a company model when the deployment has none', () => {
        const r = resolveProvided();
        expect(isRefusal(r)).toBe(false);
        if (isRefusal(r)) return;
        expect(r.source).toBe('managed');
        expect(r.provider.model).toBe('');
        expect(r.provider.endpoint).toBe(ENV_URL);
    });

    it('control: with a deployment model it uses that model, still never the company one', () => {
        const r = resolveProvided({ model: 'env-model' });
        if (isRefusal(r)) throw new Error('expected a provider');
        expect(r.provider.model).toBe('env-model');
    });

    it('control: the same company on its own key does take its own model', () => {
        const r = resolveProvided({ tenantKey: 'company-key' });
        if (isRefusal(r)) throw new Error('expected a provider');
        expect(r.source).toBe('byo');
        expect(r.provider.model).toBe('company-model');
        expect(r.provider.endpoint).toBe(COMPANY_URL);
    });

    it('an unusable provided configuration says nothing the company could act on, and logs the operator hint', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const noModel = new OpenAiCompatibleProvider({ apiKey: 'k', model: '', baseUrl: ENV_URL });
        let err: unknown;
        try { assertProviderConfigured(noModel, 'managed'); } catch (e) { err = e; }

        expect(err).toMatchObject({ status: 503, code: 'ai_not_configured', message: 'AI is not available right now.' });
        expect(JSON.stringify(warn.mock.calls)).toContain('AI_MODEL');
    });

    it('control: a complete provided configuration passes', () => {
        const ok = new OpenAiCompatibleProvider({ apiKey: 'k', model: 'env-model', baseUrl: ENV_URL });
        expect(() => assertProviderConfigured(ok, 'managed')).not.toThrow();
    });
});

describe('the adapter refuses an empty endpoint itself', () => {
    it('throws the stable code and makes no request', async () => {
        const adapter = new OpenAiCompatibleProvider({ apiKey: 'k', model: 'm', baseUrl: '' });
        await expect(adapter.complete({ prompt: 'p' })).rejects.toMatchObject({ code: 'ai_not_configured', status: 503 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('control: the same adapter with an endpoint sends', async () => {
        const adapter = new OpenAiCompatibleProvider({ apiKey: 'k', model: 'm', baseUrl: COMPANY_URL });
        await adapter.complete({ prompt: 'p' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('an unknown model is a visible error, not an empty result', () => {
    // The provider's own words: only a body that says the model is unknown is
    // treated as one. A bare 404 or 400 is not (see the controls below).
    const NOT_FOUND = () => new Response(
        JSON.stringify({ error: { code: 'model_not_found', message: 'The model does not exist' } }),
        { status: 404 },
    );

    it('suggestComment names the model and where to change it', async () => {
        fetchMock.mockImplementation(async () => NOT_FOUND());
        const err = await build({ tenantModel: 'retired-model', tenantBaseUrl: COMPANY_URL })
            .suggestComment(PROMPT_ARGS).catch((e: unknown) => e);

        expect(err).toMatchObject({
            status: 503,
            code: 'ai_not_configured',
            message: 'The AI service did not recognise the model name retired-model. Check it in Settings → Advanced → AI.',
        });
    });

    it('a 400 that names the model as missing reads the same way', async () => {
        fetchMock.mockImplementation(async () => new Response(
            JSON.stringify({ error: { message: 'Unknown model: retired-model' } }), { status: 400 },
        ));
        await expect(build({ tenantModel: 'retired-model', tenantBaseUrl: COMPANY_URL }).generateProfessionalComment('x'))
            .rejects.toMatchObject({ code: 'ai_not_configured', message: expect.stringContaining('retired-model') });
    });

    it('control: a bare 400 or 404 is NOT blamed on the model, and suggestComment degrades', async () => {
        for (const status of [400, 404]) {
            fetchMock.mockImplementation(async () => new Response('{}', { status }));
            const svc = build({ tenantModel: 'company-model', tenantBaseUrl: COMPANY_URL });
            await expect(svc.generateProfessionalComment('x')).rejects.toThrow('Failed to generate content from AI');
            expect((await svc.suggestComment(PROMPT_ARGS)).suggestions).toEqual([]);
        }
    });

    it('control: an ordinary server failure still degrades to no suggestions', async () => {
        fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }));
        const out = await build({ tenantModel: 'company-model', tenantBaseUrl: COMPANY_URL }).suggestComment(PROMPT_ARGS);
        expect(out.suggestions).toEqual([]);
    });

    it('on the provided path the company is not told to change a setting it does not control', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const err = unknownModelRefusal('env-model', 'managed');

        expect(err).toMatchObject({ code: 'ai_not_configured', message: 'AI is not available right now.' });
        expect(JSON.stringify(warn.mock.calls)).toContain('env-model');
        expect(unknownModelRefusal('env-model', 'byo').message).toContain('Settings → Advanced → AI');
    });
});
