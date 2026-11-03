/**
 * The repair builder and the share page answer from field lists (server/lib/repair-request-view.ts).
 *
 * Each route is given FULL rows, with every column the tables hold including the ones no page reads, and the response must
 * carry exactly the listed keys: a column added to a table later is not carried until it is named. The lists are also held to
 * the response schemas, so a list and its schema cannot drift apart.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/public-access', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/public-access')>();
    return { ...actual, resolveOwnerPreviewFull: vi.fn().mockResolvedValue(null), resolveAgentSession: vi.fn().mockResolvedValue(null) };
});

// eslint-disable-next-line import/order
import { makeServices, buildApp, buildShareApp, makeGatePassDb, VALID_TOKEN_ROW, SHARE_RR } from '../helpers/repair-builder-routes-harness';
import { REPAIR_VIEW_FIELD_LISTS } from '../../../server/lib/repair-request-view';
import { RepairBuilderLineSchema, RepairRequestViewSchema, RepairShareLineSchema } from '../../../server/lib/validations/repair-request-view.schema';

const NOW = new Date('2026-02-03T04:05:06Z');
/** Every column of repair_requests. */
const REQUEST_ROW = {
    id: 'rr1', tenantId: 't1', inspectionId: 'insp1', createdByKind: 'client', createdByRef: 'buyer@example.com', customIntro: 'Please review',
    shareToken: 'share-tok-abc', createdAt: NOW, updatedAt: NOW, expiresAt: null, revokedAt: null,
};
/** Every column of repair_request_items. */
const ITEM_ROW = {
    id: 'item1', tenantId: 't1', repairRequestId: 'rr1', findingKey: 'canned:s1:i1', sectionTitle: 'Roof', itemLabel: 'Shingles',
    commentSnapshot: 'Cracked', requestedCreditCents: 5000, note: 'Please fix', sortOrder: 0, defectTitleSnapshot: 'Cracked shingles',
    locationSnapshot: 'North slope', categorySnapshot: 'safety', tradeSnapshot: 'licensed roofer', repairActionTag: 'repair',
};
const PRIVATE_REQUEST = ['tenantId', 'createdByKind', 'createdByRef'];
const PRIVATE_ITEM = ['tenantId', 'repairRequestId'];
const sorted = (keys: readonly string[]) => [...keys].sort();
const keysOf = (value: unknown) => sorted(Object.keys(value as object));

const builder = (services: ReturnType<typeof makeServices>) => buildApp({
    portalTokenRow: VALID_TOKEN_ROW,
    services,
    dbFactory: makeGatePassDb,
});
const auth = (extra: Partial<Parameters<typeof makeServices>[0]>) => makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), ...extra });

describe('the repair builder responses', () => {
    it('create: the list carries the request fields and nothing the row holds beyond them', async () => {
        const { app } = builder(auth({ create: vi.fn().mockResolvedValue(REQUEST_ROW) }));
        const res = await app.request('/api/public/repair-builder/t1/insp1?token=tok1', { method: 'POST' });
        expect(res.status).toBe(200);
        const { data } = await res.json() as { data: Record<string, unknown> };
        expect(keysOf(data)).toEqual(sorted(REPAIR_VIEW_FIELD_LISTS.request));
        for (const key of PRIVATE_REQUEST) expect(data).not.toHaveProperty(key);
        expect(RepairRequestViewSchema.safeParse(data).success).toBe(true);
    });

    it('get list: the request and every line carry the listed fields', async () => {
        const get = vi.fn().mockResolvedValue({ request: REQUEST_ROW, items: [ITEM_ROW] });
        const { app } = builder(auth({ get, creditTotal: vi.fn().mockResolvedValue(5000) }));
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1?token=tok1');
        expect(res.status).toBe(200);
        const { data } = await res.json() as { data: { request: unknown; items: unknown[]; creditTotal: number } };
        expect(keysOf(data.request)).toEqual(sorted(REPAIR_VIEW_FIELD_LISTS.request));
        expect(data.items).toHaveLength(1);
        expect(keysOf(data.items[0])).toEqual(sorted(REPAIR_VIEW_FIELD_LISTS.builderLine));
        for (const key of PRIVATE_ITEM) expect(data.items[0]).not.toHaveProperty(key);
        expect(RepairBuilderLineSchema.safeParse(data.items[0]).success).toBe(true);
        expect(data.creditTotal).toBe(5000);
    });

    it('add item: the created line carries the listed fields', async () => {
        const { app } = builder(auth({ addItem: vi.fn().mockResolvedValue(ITEM_ROW) }));
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ findingKey: 'canned:s1:i1', sectionTitle: 'Roof', itemLabel: 'Shingles' }),
        });
        expect(res.status).toBe(200);
        const { data } = await res.json() as { data: unknown };
        expect(keysOf(data)).toEqual(sorted(REPAIR_VIEW_FIELD_LISTS.builderLine));
    });

    it('source: the caller lists carry the request fields and their lines, which the page matches by finding key', async () => {
        const { app } = builder(auth({ listMineWithItems: vi.fn().mockResolvedValue([{ ...REQUEST_ROW, items: [ITEM_ROW] }]) }));
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(200);
        const { data } = await res.json() as { data: { mine: Array<Record<string, unknown> & { items: unknown[] }> } };
        const [list] = data.mine;
        expect(keysOf(list)).toEqual(sorted([...REPAIR_VIEW_FIELD_LISTS.request, 'items']));
        expect(keysOf(list?.items[0])).toEqual(sorted(REPAIR_VIEW_FIELD_LISTS.builderLine));
        expect(list?.items[0]).toMatchObject({ findingKey: 'canned:s1:i1' });
        // Control: the rows really did hold the private columns, so their absence is the projection's doing.
        for (const key of PRIVATE_REQUEST) expect(REQUEST_ROW).toHaveProperty(key);
    });
});

describe('the repair share view', () => {
    it('carries the lines the share page reads and none of the columns it does not', async () => {
        const { app } = buildShareApp({ rrResult: { request: SHARE_RR, items: [ITEM_ROW] as never } });
        const res = await app.request('/api/public/repair-request/share/share-tok-abc');
        expect(res.status).toBe(200);
        const { data } = await res.json() as { data: { propertyAddress: string; customIntro: string; items: unknown[]; creditTotal: number } };
        expect(keysOf(data)).toEqual(['creditTotal', 'customIntro', 'items', 'propertyAddress']);
        expect(keysOf(data.items[0])).toEqual(sorted(REPAIR_VIEW_FIELD_LISTS.shareLine));
        for (const key of [...PRIVATE_ITEM, 'findingKey']) expect(data.items[0]).not.toHaveProperty(key);
        expect(RepairShareLineSchema.safeParse(data.items[0]).success).toBe(true);
        expect(JSON.stringify(data)).not.toContain('buyer@example.com');
    });
});

describe('the field lists', () => {
    it('are the keys of the schemas that describe them', () => {
        expect(sorted(REPAIR_VIEW_FIELD_LISTS.request)).toEqual(sorted(Object.keys(RepairRequestViewSchema.shape)));
        expect(sorted(REPAIR_VIEW_FIELD_LISTS.builderLine)).toEqual(sorted(Object.keys(RepairBuilderLineSchema.shape)));
        expect(sorted(REPAIR_VIEW_FIELD_LISTS.shareLine)).toEqual(sorted(Object.keys(RepairShareLineSchema.shape)));
    });
});
