/**
 * AI call provenance — the evidence that an AI governance artifact is supposed
 * to produce.
 *
 * The prompts have carried stable version tokens for a while, but nothing read
 * `.version`: the call sites rendered a string and handed it to the model, so
 * the versioning existed as a naming convention with no output. A record that
 * is never written cannot answer the one question the tokens were introduced
 * for — "which prompt produced this text, on whose credentials, against which
 * model, when".
 *
 * Two things these tests are deliberately shaped around:
 *
 *  1. FIELD BY FIELD. A test that asserts "one row was written" passes just as
 *     happily when five of its columns are null, which is the same amount of
 *     evidence as no row at all. Every case below names every column.
 *  2. NO PROMPT TEXT. Defect notes are inspector free text and routinely carry
 *     a client's name and the property address. The row is metadata only, and
 *     the last case proves it by sending an address through the chokepoint and
 *     looking for it in the stored row.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { buildAiProvenanceSink, type AiProvenanceSink } from '../../../server/lib/ai/provenance';
import { AIService } from '../../../server/services/ai.service';
import { OpenAiCompatibleProvider } from '../../../server/lib/ai/providers/openai-compatible';

/**
 * A real adapter over the mocked `fetch`, supplied wherever a case is meant to
 * REACH a backend. The service no longer builds one for itself — credential,
 * endpoint and model selection is `resolve-provider.ts`'s — so a construction
 * that omits this is a construction that refuses to run, which is exactly what
 * the fail-closed cases below rely on.
 */
const ADAPTER = () => new OpenAiCompatibleProvider({
    apiKey: 'a-key', model: 'a-model', baseUrl: 'https://api.example.test/v1',
});

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 'tenant-provenance';
/** The only credential picture the capability gate lets through. */
const OWN_CONFIRMED_KEY = { source: 'byo', tenantKeyAttested: true } as const;
const MANAGED = { source: 'managed', tenantKeyAttested: false } as const;
/** The id the stub sink claims to have written, so a caller citing it can be
 *  distinguished from a caller inventing one. */
const AI_CALL_ROW_ID = 'ai-call-row-1';

let db: BetterSQLite3Database<typeof schema>;

async function freshDb() {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    vi.mocked(mockDrizzle).mockReturnValue(db as never);
}

function rows() {
    return db.select().from(schema.aiCallProvenance).all();
}

describe('the provenance sink writes one fully-populated row', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('records tenant, capability, provider, mode, model, prompt version and time', async () => {
        const before = Date.now();
        const sink = buildAiProvenanceSink({
            db: {} as D1Database, tenantId: TENANT, source: 'byo', model: 'a-configured-model',
        });
        const returnedId = await sink!.record({ capability: 'assist', promptVersion: 'professional-comment.v1', provider: 'api.example.test', endpoint: 'https://api.example.test/v1' });

        const all = rows();
        expect(all).toHaveLength(1);
        const row = all[0]!;
        // Field by field. "A row exists" is not evidence: a row whose provider,
        // mode, model and prompt version are all null answers nothing.
        expect(row.id).toMatch(/\S/);
        // The id the caller is handed must be the id of the row that was
        // written. A sink that minted one id for the insert and returned another
        // would satisfy every other assertion here while every review record
        // citing it pointed at nothing.
        expect(returnedId).toBe(row.id);
        expect(row.tenantId).toBe(TENANT);
        expect(row.capability).toBe('assist');
        expect(row.provider).toBe('api.example.test');
        expect(row.mode).toBe('byo');
        expect(row.model).toBe('a-configured-model');
        expect(row.promptVersion).toBe('professional-comment.v1');
        expect(row.createdAt).toBeInstanceOf(Date);
        expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(row.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('carries the managed/byo mode it was built with, not a re-derived one', async () => {
        const sink = buildAiProvenanceSink({
            db: {} as D1Database, tenantId: TENANT, source: 'managed', model: 'm',
        });
        await sink!.record({ capability: 'translate', promptVersion: 'x.v1', provider: 'api.example.test', endpoint: 'https://api.example.test/v1' });
        expect(rows()[0]!.mode).toBe('managed');
        expect(rows()[0]!.capability).toBe('translate');
    });

    it('has no sink at all when there is no tenant to attribute the call to', () => {
        // `tenant_id` is NOT NULL and every row must belong to exactly one
        // workspace. No tenant means no row — and, at the chokepoint, no call.
        expect(buildAiProvenanceSink({
            db: {} as D1Database, tenantId: null, source: 'byo', model: 'm',
        })).toBeUndefined();
    });
});

describe('the chokepoint records every AI call', () => {
    const fetchMock = vi.fn();
    let originalFetch: typeof globalThis.fetch;
    let record: ReturnType<typeof vi.fn>;
    let sink: AiProvenanceSink;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(new Response(
            JSON.stringify({ choices: [{ message: { content: '["a","b","c"]' } }] }), { status: 200 },
        ));
        record = vi.fn(async () => AI_CALL_ROW_ID);
        sink = { record } as unknown as AiProvenanceSink;
    });
    afterEach(() => { globalThis.fetch = originalFetch; });

    const service = (provenance?: AiProvenanceSink) => new AIService(
        {} as D1Database, 'a-key', 'saas', 'a-model', undefined, OWN_CONFIRMED_KEY, provenance,
        undefined, ADAPTER(),
    );

    it('names the professional-comment prompt version', async () => {
        await service(sink).generateProfessionalComment('rough note');
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith({
            capability: 'assist', promptVersion: 'professional-comment.v1', provider: 'api.example.test',
            // The destination the adapter under test was built with. Asserted
            // exhaustively like every other field: an entry checked field by
            // field except one is an entry that field can go missing from.
            endpoint: 'https://api.example.test/v1',
        });
    });

    it('names the rewrite-comment prompt version', async () => {
        await service(sink).rewriteComment({
            itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'foo', instruction: 'shorten',
        });
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith({
            capability: 'assist', promptVersion: 'rewrite-comment.v1', provider: 'api.example.test',
            // The destination the adapter under test was built with. Asserted
            // exhaustively like every other field: an entry checked field by
            // field except one is an entry that field can go missing from.
            endpoint: 'https://api.example.test/v1',
        });
    });

    it('names the suggest-comment prompt version', async () => {
        await service(sink).suggestComment({ itemName: 'Roof', sectionName: 'Roof' });
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith({
            capability: 'assist', promptVersion: 'suggest-comment.v1', provider: 'api.example.test',
            // The destination the adapter under test was built with. Asserted
            // exhaustively like every other field: an entry checked field by
            // field except one is an entry that field can go missing from.
            endpoint: 'https://api.example.test/v1',
        });
    });

    it('records BEFORE the prompt leaves the process', async () => {
        // Ordering is the whole claim. Recorded after the response, a provider
        // call that succeeded while the write failed would have sent inspection
        // content with no trace of it. The prompt is what leaves; the record
        // must precede it, so a sink that refuses stops the send.
        record.mockRejectedValueOnce(new Error('d1 down'));
        await expect(service(sink).generateProfessionalComment('rough note')).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to run at all when no sink was supplied', async () => {
        // The fail-closed default, and the reason it is not merely optional: a
        // future call site that constructs AIService without a sink must not
        // inherit a silent bypass. An object that declares nothing about
        // provenance has not established one.
        await expect(service(undefined).generateProfessionalComment('rough note'))
            .rejects.toMatchObject({ code: 'ai_not_configured' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('writes nothing when the capability gate refuses the call', async () => {
        // Nothing was sent, so there is nothing to have provenance OF. The gate
        // sits ahead of the record for the same reason it sits ahead of the
        // meter.
        const svc = new AIService({} as D1Database, 'a-key', 'saas', 'a-model', undefined, MANAGED, sink);
        await expect(svc.generateProfessionalComment('rough note')).rejects.toMatchObject({ code: 'ai_not_configured' });
        expect(record).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

/**
 * The id has to reach the CALLER, not just the row.
 *
 * A ledger that records every call and cannot tell a caller which row is theirs
 * produces no citable evidence: review of an output had nothing to point at, so
 * the AI call and its acceptance stayed two events with nothing linking them.
 * These cases are about that link, one per public method — and about the arms
 * that must NOT carry an id, because prose no model wrote must never arrive
 * looking like reviewed model output.
 */
describe('the chokepoint hands the provenance row id to its caller', () => {
    const fetchMock = vi.fn();
    let originalFetch: typeof globalThis.fetch;
    let record: ReturnType<typeof vi.fn>;
    let sink: AiProvenanceSink;

    const INSPECTION = 'insp-review-1';

    beforeEach(async () => {
        await freshDb();
        originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(new Response(
            JSON.stringify({ choices: [{ message: { content: '["a","b","c"]' } }] }), { status: 200 },
        ));
        record = vi.fn(async () => AI_CALL_ROW_ID);
        sink = { record } as unknown as AiProvenanceSink;
    });
    afterEach(() => { globalThis.fetch = originalFetch; });

    const service = (mode: 'standalone' | 'saas' = 'saas', apiKey = 'a-key') => new AIService(
        {} as D1Database, apiKey, mode, 'a-model', undefined, OWN_CONFIRMED_KEY, sink,
        undefined, ADAPTER(),
    );

    /** The summary path reads the inspection before it reaches the chokepoint,
     *  and `inspections.tenant_id` carries a legacy FK, so the workspace row has
     *  to exist too — the migrations enable foreign_keys. */
    async function seedInspection() {
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'provenance-co', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Test St',
            date: '2026-08-08', createdAt: new Date(),
        });
    }

    it('comment-assist returns the id of the row written for that call', async () => {
        const out = await service().generateProfessionalComment('rough note');
        expect(out.aiCallId).toBe(AI_CALL_ROW_ID);
        expect(out.text).toBe('["a","b","c"]');
    });

    it('comment rewrite returns the id alongside the rewritten text', async () => {
        const out = await service().rewriteComment({
            itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'foo', instruction: 'shorten',
        });
        expect(out.aiCallId).toBe(AI_CALL_ROW_ID);
        expect(out.rewritten).toContain('a');
    });

    it('suggest-comment returns the id alongside the parsed suggestions', async () => {
        const out = await service().suggestComment({ itemName: 'Roof', sectionName: 'Roof' });
        expect(out.aiCallId).toBe(AI_CALL_ROW_ID);
        expect(out.suggestions).toEqual(['a', 'b', 'c']);
    });

    it('auto-summary returns the id alongside the generated summary', async () => {
        await seedInspection();
        await db.insert(schema.inspectionResults).values({
            id: 'res-1', tenantId: TENANT, inspectionId: INSPECTION,
            data: { 'item-1': { status: 'Defect', notes: 'cracked flashing' } },
            lastSyncedAt: new Date(),
        });
        fetchMock.mockResolvedValue(new Response(
            JSON.stringify({ choices: [{ message: { content: 'a summary' } }] }), { status: 200 },
        ));

        const out = await service().generateInspectionSummary(TENANT, INSPECTION);
        expect(out.summary).toBe('a summary');
        expect(out.aiCallId).toBe(AI_CALL_ROW_ID);
    });

    it('the no-defects summary carries NO id, because no model wrote it', async () => {
        // The inspection EXISTS and the method returns normally — without that
        // half, "aiCallId is null" would also pass if the lookup had thrown or
        // the method had never run at all. The literal is the system speaking,
        // and an id here would document a review of model output that was never
        // generated.
        await seedInspection();
        const out = await service().generateInspectionSummary(TENANT, INSPECTION);
        expect(out.summary).toMatch(/^No significant defects/);
        expect(out.aiCallId).toBeNull();
        expect(record).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('the standalone dev mocks carry NO id', async () => {
        // No key at all, so nothing is sent and nothing is recorded. `[DEV]`
        // placeholder prose must not be citable as reviewed model output.
        const svc = service('standalone', '');
        const rewrite = await svc.rewriteComment({
            itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'Old text', instruction: 'shorten',
        });
        expect(rewrite.rewritten).toMatch(/^\[DEV\] /);
        expect(rewrite.aiCallId).toBeNull();

        const suggest = await svc.suggestComment({ itemName: 'Roof', sectionName: 'Roof' });
        expect(suggest.suggestions).toHaveLength(3);
        expect(suggest.aiCallId).toBeNull();
        expect(record).not.toHaveBeenCalled();
    });

    it('an unparseable completion returns no suggestions and no id — but the call DID run', async () => {
        // The absence-assertion trap: "aiCallId is null" is satisfied for free
        // by a method that never reached the provider. The provenance write and
        // the outbound call are asserted to have happened, so the null is about
        // the completion being unusable and nothing else.
        fetchMock.mockResolvedValue(new Response(
            JSON.stringify({ choices: [{ message: { content: 'no array here' } }] }), { status: 200 },
        ));
        const out = await service().suggestComment({ itemName: 'Roof', sectionName: 'Roof' });
        expect(out.suggestions).toEqual([]);
        expect(out.aiCallId).toBeNull();
        expect(record).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});

describe('no prompt text is ever stored', () => {
    const fetchMock = vi.fn();
    let originalFetch: typeof globalThis.fetch;

    beforeEach(async () => {
        await freshDb();
        originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(new Response(
            JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 },
        ));
    });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('a defect note carrying a client address leaves no trace in the row', async () => {
        // A rough note is inspector free text. This one is written the way a
        // real one is, and none of it may reach the ledger — the row is
        // metadata about a call, never a copy of what was said in it.
        const sink = buildAiProvenanceSink({
            db: {} as D1Database, tenantId: TENANT, source: 'byo', model: 'a-model',
        });
        const svc = new AIService({} as D1Database, 'a-key', 'saas', 'a-model', undefined, OWN_CONFIRMED_KEY, sink, undefined, ADAPTER());
        await svc.generateProfessionalComment('Jane Q. Client at 123 Oak St: cracked flashing');

        const all = rows();
        expect(all).toHaveLength(1);
        const stored = JSON.stringify(all[0]);
        expect(stored).not.toContain('Oak St');
        expect(stored).not.toContain('Jane');
        expect(stored).not.toContain('cracked flashing');
    });
});

describe('endpoint — the destination the row was missing', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('stores where the adapter that ran actually sends', async () => {
        const sink = buildAiProvenanceSink({
            db: {} as D1Database, tenantId: TENANT, source: 'byo', model: 'a-model',
        })!;
        await sink.record({
            capability: 'assist',
            promptVersion: 'v1',
            provider: 'api.example.test',
            endpoint: 'https://api.example.test/v1',
        });
        const row = rows().at(-1)!;
        expect(row.endpoint).toBe('https://api.example.test/v1');
    });
});

describe('the assurance export carries the destination', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('returns endpoint alongside provider and model', async () => {
        // The export selects columns by name, not `select *`. A column added to
        // the table and not to this list is a record of "what the automated
        // system did on the tenant's behalf" that is missing where it went.
        const sink = buildAiProvenanceSink({
            db: {} as D1Database, tenantId: TENANT, source: 'byo', model: 'a-model',
        })!;
        await sink.record({
            capability: 'assist', promptVersion: 'v1',
            provider: 'h', endpoint: 'https://h/v1',
        });
        const { readAiAssurance } = await import('../../../server/lib/compliance/assurance-records');
        const out = await readAiAssurance(db as never, { tenantId: TENANT });
        expect(out.calls[0]).toMatchObject({ endpoint: 'https://h/v1' });
    });
});
