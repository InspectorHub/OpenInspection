/**
 * Cross-creator / cross-inspection isolation + source-route hydration for
 * repair-builder (split from repair-builder-routes.spec.ts).
 *
 *  - assertCanEdit: a different creator cannot edit a list they do not own.
 *  - B1: source route hydration — mine[].items must be populated.
 *  - I1: cross-inspection read via authed route must return 404.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../server/lib/public-access', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../server/lib/public-access')>();
    return {
        ...actual,
        resolveOwnerPreviewFull: vi.fn().mockResolvedValue(null),
        resolveAgentSession: vi.fn().mockResolvedValue(null),
    };
});

// eslint-disable-next-line import/order
import { makeServices, buildApp, makeGatePassDb, VALID_TOKEN_ROW } from './helpers/repair-builder-routes-harness';

describe('assertCanEdit: different creator cannot edit', () => {
    it('403 when a different client ref tries to POST an item to a list they do not own', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        // assertCanEdit is called with creator = {kind:'client', ref:'buyer@example.com'},
        // but the RR was created by 'other@example.com' — service throws Forbidden.
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Not the creator of this repair request'));
        const ITEM_BODY = {
            findingKey: 'canned:s1:item1:roof',
            sectionTitle: 'Roof',
            itemLabel: 'Shingles',
        };
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr-other/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ITEM_BODY),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });
});

// ---------------------------------------------------------------------------
// B1: source route hydration — mine[].items must be populated
// ---------------------------------------------------------------------------

describe('B1: GET .../source → mine[0].items is populated from persisted list', () => {
    it('mine[0].items contains the item hydrated from get()', async () => {
        // Simulate: listMine returns one RR row (as listMineWithItems does now),
        // which already includes its items array.
        const persistedItem = {
            id: 'item-server-1',
            findingKey: 'canned:s1:item1:roof',
            sectionTitle: 'Roof',
            itemLabel: 'Missing shingles',
            commentSnapshot: 'worn',
            requestedCreditCents: 25000,
            note: null,
            sortOrder: 0,
        };
        const rrWithItems = {
            id: 'rr1',
            inspectionId: 'insp1',
            tenantId: 't1',
            customIntro: null,
            shareToken: 'share-tok',
            items: [persistedItem],
        };
        const listMine = vi.fn().mockResolvedValue([rrWithItems]);
        const resolveToken = vi.fn().mockResolvedValue(VALID_TOKEN_ROW);

        const { app } = buildApp({
            services: makeServices({ portalAccessResolveToken: resolveToken, listMine }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(200);

        const body = await res.json() as {
            success: boolean;
            data: { defects: unknown[]; mine: Array<{ id: string; items: unknown[] }> };
        };
        expect(body.success).toBe(true);
        expect(body.data.mine).toHaveLength(1);
        // The mine entry must carry the items array so the builder page can rehydrate
        expect(body.data.mine[0].items).toHaveLength(1);
        expect((body.data.mine[0].items[0] as Record<string, unknown>).findingKey).toBe('canned:s1:item1:roof');
    });
});

// ---------------------------------------------------------------------------
// I1: cross-inspection read via authed route — must return 404
// ---------------------------------------------------------------------------

describe('I1: GET /lists/:rrId — list belonging to inspection B is NOT returned for inspection A', () => {
    it('404 when rrId belongs to inspectionId B but URL uses inspectionId A', async () => {
        // The service's get() now takes (tenantId, inspectionId, rrId).
        // When rrId belongs to 'insp-B' but the URL says 'insp-A', get() returns null → 404.
        const get = vi.fn().mockResolvedValue(null); // inspectionId mismatch → null
        const resolveToken = vi.fn().mockResolvedValue(VALID_TOKEN_ROW); // grants access to insp1 (A)

        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: resolveToken, get }),
            dbFactory: makeGatePassDb,
        });

        // rrId-of-B is on inspection B; URL says inspection insp1 (A)
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rrId-of-B?token=tok1');
        expect(res.status).toBe(404);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_FOUND');

        // Verify the route DID pass inspectionId to get()
        expect(get).toHaveBeenCalledWith('t1', 'insp1', 'rrId-of-B');
    });
});
