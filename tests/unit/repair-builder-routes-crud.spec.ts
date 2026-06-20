/**
 * CRUD builder routes for repair-builder (split from repair-builder-routes.spec.ts).
 *
 * All CRUD routes share the same gate: auth → publish → tenant-flag.
 * Mutating routes additionally call assertCanEdit (checks creator ownership).
 * The gate is exercised via the raw drizzle mock (makeTwoQueryDb); all
 * business logic is handled by the service stubs.
 *
 * Helpers: VALID_TOKEN_ROW (client auth) + makeGatePassDb / makeUnpublishedDb.
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
import { makeServices, buildApp, makeGatePassDb, makeUnpublishedDb, VALID_TOKEN_ROW } from './helpers/repair-builder-routes-harness';

describe('POST /api/public/repair-builder/:tenant/:id — create list', () => {
    it('200 and returns rr with id + shareToken for valid client', async () => {
        const createdRr = { id: 'rr-new', shareToken: 'share-abc', inspectionId: 'insp1', tenantId: 't1' };
        const create = vi.fn().mockResolvedValue(createdRr);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), create }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1?token=tok1', { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: Record<string, unknown> };
        expect(body.success).toBe(true);
        expect(body.data.id).toBe('rr-new');
        expect(body.data.shareToken).toBe('share-abc');
        expect(create).toHaveBeenCalledWith('t1', 'insp1', { kind: 'client', ref: 'buyer@example.com' });
    });

    it('401 when no auth token provided', async () => {
        const { app } = buildApp({ dbFactory: makeGatePassDb });
        const res = await app.request('/api/public/repair-builder/t1/insp1', { method: 'POST' });
        expect(res.status).toBe(401);
    });

    it('403 NOT_PUBLISHED for create on an unpublished report', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW) }),
            dbFactory: makeUnpublishedDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1?token=tok1', { method: 'POST' });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });
});

describe('GET /api/public/repair-builder/:tenant/:id/lists/:rrId — get list', () => {
    const RR = { id: 'rr1', inspectionId: 'insp1', tenantId: 't1', createdByKind: 'client', createdByRef: 'buyer@example.com' };
    const ITEMS = [{ id: 'item1', requestedCreditCents: 5000, sortOrder: 0 }];

    it('200 with request + items + creditTotal', async () => {
        const get = vi.fn().mockResolvedValue({ request: RR, items: ITEMS });
        const creditTotal = vi.fn().mockResolvedValue(5000);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), get, creditTotal }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1?token=tok1');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { request: unknown; items: unknown[]; creditTotal: number } };
        expect(body.success).toBe(true);
        expect(body.data.items).toHaveLength(1);
        expect(body.data.creditTotal).toBe(5000);
        // I1: get() and creditTotal() now receive inspectionId as 2nd arg.
        expect(get).toHaveBeenCalledWith('t1', 'insp1', 'rr1');
        expect(creditTotal).toHaveBeenCalledWith('t1', 'insp1', 'rr1');
    });

    it('404 when rr does not exist', async () => {
        const get = vi.fn().mockResolvedValue(null);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), get }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/no-such?token=tok1');
        expect(res.status).toBe(404);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_FOUND');
    });
});

describe('POST .../lists/:rrId/items — add item', () => {
    const ITEM_BODY = {
        findingKey: 'canned:s1:item1:roof',
        sectionTitle: 'Roof',
        itemLabel: 'Missing shingles',
        requestedCreditCents: 25000,
        note: 'Needs full replacement',
    };

    it('200 and returns the new item', async () => {
        const newItem = { id: 'item-new', ...ITEM_BODY };
        const addItem = vi.fn().mockResolvedValue(newItem);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), addItem, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ITEM_BODY),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: Record<string, unknown> };
        expect(body.success).toBe(true);
        expect(body.data.id).toBe('item-new');
        // I1: assertCanEdit now receives inspectionId as 2nd arg.
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'insp1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        // Route normalizes undefined optional fields to null per ItemInput.
        expect(addItem).toHaveBeenCalledWith('t1', 'rr1', { ...ITEM_BODY, commentSnapshot: null });
    });

    it('403 FORBIDDEN when assertCanEdit throws (not the creator)', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Not the creator'));
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ITEM_BODY),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });

    it('403 NOT_PUBLISHED when report is unpublished (publish gate on add-item)', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW) }),
            dbFactory: makeUnpublishedDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ITEM_BODY),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('400 when requestedCreditCents is negative', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW) }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...ITEM_BODY, requestedCreditCents: -1 }),
        });
        expect(res.status).toBe(400);
    });
});

describe('PATCH .../lists/:rrId/items/:itemId — update item', () => {
    it('200 on valid patch (requestedCreditCents + note)', async () => {
        const updateItem = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), updateItem, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestedCreditCents: 10000, note: 'Updated note' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        // I1: assertCanEdit and updateItem now receive inspectionId as 2nd arg.
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'insp1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        expect(updateItem).toHaveBeenCalledWith('t1', 'insp1', 'rr1', 'item1', { requestedCreditCents: 10000, note: 'Updated note' });
    });

    it('200 on valid patch (sortOrder only)', async () => {
        const updateItem = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), updateItem, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sortOrder: 3 }),
        });
        expect(res.status).toBe(200);
        expect(updateItem).toHaveBeenCalledWith('t1', 'insp1', 'rr1', 'item1', { sortOrder: 3 });
    });

    it('403 FORBIDDEN from assertCanEdit on patch', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Forbidden'));
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'hi' }),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });
});

describe('DELETE .../lists/:rrId/items/:itemId — remove item', () => {
    it('200 on successful delete', async () => {
        const removeItem = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), removeItem, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'DELETE',
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        // I1: assertCanEdit and removeItem now receive inspectionId as 2nd arg.
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'insp1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        expect(removeItem).toHaveBeenCalledWith('t1', 'insp1', 'rr1', 'item1');
    });

    it('403 FORBIDDEN from assertCanEdit on delete', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Forbidden'));
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items/item1?token=tok1', {
            method: 'DELETE',
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });
});

describe('PATCH .../lists/:rrId — set intro', () => {
    it('200 on setIntro', async () => {
        const setIntro = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), setIntro, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customIntro: 'Please fix these items.' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        // I1: assertCanEdit and setIntro now receive inspectionId as 2nd arg.
        expect(assertCanEdit).toHaveBeenCalledWith('t1', 'insp1', 'rr1', { kind: 'client', ref: 'buyer@example.com' });
        expect(setIntro).toHaveBeenCalledWith('t1', 'insp1', 'rr1', 'Please fix these items.');
    });

    it('200 when customIntro is null (clearing)', async () => {
        const setIntro = vi.fn().mockResolvedValue(undefined);
        const assertCanEdit = vi.fn().mockResolvedValue(undefined);
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), setIntro, assertCanEdit }),
            dbFactory: makeGatePassDb,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customIntro: null }),
        });
        expect(res.status).toBe(200);
        expect(setIntro).toHaveBeenCalledWith('t1', 'insp1', 'rr1', null);
    });

    it('403 FORBIDDEN from assertCanEdit on setIntro', async () => {
        const { AppError: AE } = await import('../../server/lib/errors');
        const assertCanEdit = vi.fn().mockRejectedValue(new AE(403, 'forbidden' as never, 'Forbidden'));
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            services: makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW), assertCanEdit }),
            dbFactory: makeGatePassDb,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1?token=tok1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customIntro: 'try to edit' }),
        });
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('FORBIDDEN');
    });
});
