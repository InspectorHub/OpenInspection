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

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 'tenant-provenance';
/** The only credential picture the capability gate lets through. */
const OWN_CONFIRMED_KEY = { source: 'byo', tenantKeyAttested: true } as const;
const MANAGED = { source: 'managed', tenantKeyAttested: false } as const;

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
            db: {} as D1Database, tenantId: TENANT, source: 'byo', model: 'gemini-3.1-flash-lite',
        });
        await sink!.record({ capability: 'assist', promptVersion: 'professional-comment.v1', provider: 'gemini' });

        const all = rows();
        expect(all).toHaveLength(1);
        const row = all[0]!;
        // Field by field. "A row exists" is not evidence: a row whose provider,
        // mode, model and prompt version are all null answers nothing.
        expect(row.id).toMatch(/\S/);
        expect(row.tenantId).toBe(TENANT);
        expect(row.capability).toBe('assist');
        expect(row.provider).toBe('gemini');
        expect(row.mode).toBe('byo');
        expect(row.model).toBe('gemini-3.1-flash-lite');
        expect(row.promptVersion).toBe('professional-comment.v1');
        expect(row.createdAt).toBeInstanceOf(Date);
        expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(row.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('carries the managed/byo mode it was built with, not a re-derived one', async () => {
        const sink = buildAiProvenanceSink({
            db: {} as D1Database, tenantId: TENANT, source: 'managed', model: 'm',
        });
        await sink!.record({ capability: 'translate', promptVersion: 'x.v1', provider: 'gemini' });
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
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ candidates: [{ content: { parts: [{ text: '["a","b","c"]' }] } }] }),
        } as Response);
        record = vi.fn(async () => {});
        sink = { record } as unknown as AiProvenanceSink;
    });
    afterEach(() => { globalThis.fetch = originalFetch; });

    const service = (provenance?: AiProvenanceSink) => new AIService(
        {} as D1Database, 'a-key', 'saas', 'a-model', undefined, OWN_CONFIRMED_KEY, provenance,
    );

    it('names the professional-comment prompt version', async () => {
        await service(sink).generateProfessionalComment('rough note');
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith({
            capability: 'assist', promptVersion: 'professional-comment.v1', provider: 'gemini',
        });
    });

    it('names the rewrite-comment prompt version', async () => {
        await service(sink).rewriteComment({
            itemLabel: 'Roof', sectionTitle: 'Roof', tab: 'defects',
            originalComment: 'foo', instruction: 'shorten',
        });
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith({
            capability: 'assist', promptVersion: 'rewrite-comment.v1', provider: 'gemini',
        });
    });

    it('names the suggest-comment prompt version', async () => {
        await service(sink).suggestComment({ itemName: 'Roof', sectionName: 'Roof' });
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith({
            capability: 'assist', promptVersion: 'suggest-comment.v1', provider: 'gemini',
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

describe('no prompt text is ever stored', () => {
    const fetchMock = vi.fn();
    let originalFetch: typeof globalThis.fetch;

    beforeEach(async () => {
        await freshDb();
        originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        fetchMock.mockReset();
        fetchMock.mockResolvedValue({
            ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
        } as Response);
    });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('a defect note carrying a client address leaves no trace in the row', async () => {
        // A rough note is inspector free text. This one is written the way a
        // real one is, and none of it may reach the ledger — the row is
        // metadata about a call, never a copy of what was said in it.
        const sink = buildAiProvenanceSink({
            db: {} as D1Database, tenantId: TENANT, source: 'byo', model: 'a-model',
        });
        const svc = new AIService({} as D1Database, 'a-key', 'saas', 'a-model', undefined, OWN_CONFIRMED_KEY, sink);
        await svc.generateProfessionalComment('Jane Q. Client at 123 Oak St: cracked flashing');

        const all = rows();
        expect(all).toHaveLength(1);
        const stored = JSON.stringify(all[0]);
        expect(stored).not.toContain('Oak St');
        expect(stored).not.toContain('Jane');
        expect(stored).not.toContain('cracked flashing');
    });
});
