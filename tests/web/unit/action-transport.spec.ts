/**
 * Unit tests for createActionTransport.
 *
 * The transport is given a mock fetchImpl so no real network calls are made.
 * We verify:
 *   - correct URL construction
 *   - FormData field encoding (intent, replayIntent, payload fields, files)
 *   - status mapping: 200→ok, 409→conflict, 500→error, fetch-throw→re-throw
 */

import { describe, it, expect, vi } from 'vitest';
import { createActionTransport } from '~/lib/offline/action-transport';
import type { QueuedWrite, QueuedPhoto } from '~/lib/offline/queue-storage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrite(overrides: Partial<QueuedWrite> = {}): QueuedWrite {
    return {
        seq: 1,
        kind: 'write',
        inspectionId: 'insp-123',
        itemId: 'item-abc',
        field: 'rating',
        intent: 'rate',
        payload: { rating: '3', sectionId: 'sec-1' },
        enqueuedAt: 1_000_000,
        attempts: 0,
        status: 'pending',
        ...overrides,
    };
}

function makePhoto(overrides: Partial<QueuedPhoto> = {}): QueuedPhoto {
    return {
        seq: 2,
        kind: 'photo',
        inspectionId: 'insp-123',
        itemId: 'item-abc',
        name: 'photo.jpg',
        blob: new Blob(['img-data'], { type: 'image/jpeg' }),
        enqueuedAt: 1_000_001,
        attempts: 0,
        status: 'pending',
        ...overrides,
    };
}

function makeFetch(status: number, body: unknown = { ok: status < 400, apiStatus: status }) {
    return vi.fn(async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        }),
    );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createActionTransport', () => {
    // ── 1. submitWrite posts to the correct URL ───────────────────────────────
    it('submitWrite posts to /inspections/:id/edit with method POST', async () => {
        const mockFetch = makeFetch(200);
        const transport = createActionTransport(mockFetch as unknown as typeof fetch);

        await transport.submitWrite(makeWrite());

        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/inspections/insp-123/edit');
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('include');
    });

    // ── 2. submitWrite encodes FormData with intent = 'replay-write' ──────────
    it('submitWrite sends FormData with intent=replay-write and payload fields', async () => {
        const mockFetch = makeFetch(200);
        const transport = createActionTransport(mockFetch as unknown as typeof fetch);
        const write = makeWrite({
            intent: 'notes',
            field: 'notes',
            payload: { notes: 'hello', sectionId: 'sec-2' },
        });

        await transport.submitWrite(write);

        const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = init.body as FormData;
        expect(body).toBeInstanceOf(FormData);
        expect(body.get('intent')).toBe('replay-write');
        expect(body.get('replayIntent')).toBe('notes');
        expect(body.get('inspectionId')).toBe('insp-123');
        expect(body.get('itemId')).toBe('item-abc');
        expect(body.get('field')).toBe('notes');
        // payload is JSON-stringified
        const payload = JSON.parse(body.get('payload') as string);
        expect(payload).toEqual({ notes: 'hello', sectionId: 'sec-2' });
    });

    // ── 3. 200 response → { ok: true, status: 200 } ───────────────────────────
    it('maps HTTP 200 response to { ok: true, status: 200 }', async () => {
        const transport = createActionTransport(makeFetch(200) as unknown as typeof fetch);
        const result = await transport.submitWrite(makeWrite());
        expect(result).toEqual({ ok: true, status: 200 });
    });

    // ── 4. 409 response → { ok: false, status: 409 } ──────────────────────────
    it('maps HTTP 409 response to { ok: false, status: 409 }', async () => {
        const transport = createActionTransport(
            makeFetch(409, { ok: false, apiStatus: 409 }) as unknown as typeof fetch,
        );
        const result = await transport.submitWrite(makeWrite());
        expect(result).toEqual({ ok: false, status: 409 });
    });

    // ── 5. 500 response → { ok: false, status: 500 } ──────────────────────────
    it('maps HTTP 500 response to { ok: false, status: 500 }', async () => {
        const transport = createActionTransport(
            makeFetch(500, { ok: false, apiStatus: 500 }) as unknown as typeof fetch,
        );
        const result = await transport.submitWrite(makeWrite());
        expect(result).toEqual({ ok: false, status: 500 });
    });

    // ── 6. fetchImpl throws → transport re-throws (OfflineQueue stops replay) ─
    it('re-throws when fetchImpl throws (so OfflineQueue stops the replay run)', async () => {
        const throwingFetch = vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        });
        const transport = createActionTransport(throwingFetch as unknown as typeof fetch);
        await expect(transport.submitWrite(makeWrite())).rejects.toThrow('Failed to fetch');
    });

    // ── 7. submitPhoto posts to the correct URL with file in FormData ─────────
    it('submitPhoto posts to /inspections/:id/edit with intent=replay-photo and a File', async () => {
        const mockFetch = makeFetch(200, { ok: true, apiStatus: 200, key: 'photos/x.jpg' });
        const transport = createActionTransport(mockFetch as unknown as typeof fetch);

        await transport.submitPhoto(makePhoto());

        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/inspections/insp-123/edit');
        const body = init.body as FormData;
        expect(body.get('intent')).toBe('replay-photo');
        expect(body.get('itemId')).toBe('item-abc');
        expect(body.get('name')).toBe('photo.jpg');
        const file = body.get('file');
        expect(file).toBeInstanceOf(File);
        expect((file as File).name).toBe('photo.jpg');
    });

    // ── 8. 200 body with ok:false → treated as failure ────────────────────────
    it('treats 200 body with ok:false as a failure using apiStatus from body', async () => {
        // Action might return 200 HTTP but signal failure in the JSON body
        const mockFetch = makeFetch(200, { ok: false, apiStatus: 422 });
        const transport = createActionTransport(mockFetch as unknown as typeof fetch);
        const result = await transport.submitWrite(makeWrite());
        expect(result.ok).toBe(false);
        expect(result.status).toBe(422);
    });
});
