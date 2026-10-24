// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createApi } from '~/lib/api-client.server';
import { createLoadContext } from '~/lib/load-context';
import type { WorkerEnv } from '../../workers/env';

function clientWith(opts: { idempotencyKey?: string }) {
    const seen: Request[] = [];
    const fetchSpy = vi.fn(async (req: Request) => {
        seen.push(req);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const env = { API_WORKER: { fetch: fetchSpy } } as unknown as Partial<WorkerEnv>;
    const api = createApi(createLoadContext(env), { token: 'tok', ...opts });
    return { api, seen };
}

describe('createApi idempotencyKey', () => {
    it('attaches the key to the first write only', async () => {
        const { api, seen } = clientWith({ idempotencyKey: 'key-1' });
        await api.inspections[':id'].units.$post({ param: { id: 'i1' }, json: { parentUnitId: null, kind: 'unit', type: 'unit', name: 'A' } });
        await api.inspections[':id'].$patch({ param: { id: 'i1' }, json: { coverPhotoId: 'k' } });
        expect(seen[0]?.headers.get('Idempotency-Key')).toBe('key-1');
        expect(seen[1]?.headers.get('Idempotency-Key')).toBeNull();
    });

    it('sends no key when none was given', async () => {
        const { api, seen } = clientWith({});
        await api.inspections[':id'].$patch({ param: { id: 'i1' }, json: { coverPhotoId: 'k' } });
        expect(seen[0]?.headers.get('Idempotency-Key')).toBeNull();
    });

    it('does not spend the key on a read', async () => {
        const { api, seen } = clientWith({ idempotencyKey: 'key-1' });
        await api.inspections[':id'].results.$get({ param: { id: 'i1' }, query: { scope: 'x' } });
        await api.inspections[':id'].$patch({ param: { id: 'i1' }, json: { coverPhotoId: 'k' } });
        expect(seen[0]?.headers.get('Idempotency-Key')).toBeNull();
        expect(seen[1]?.headers.get('Idempotency-Key')).toBe('key-1');
    });
});

describe('createApi inFlightAsResponse', () => {
    const REFUSAL = JSON.stringify({ success: false, error: { message: 'An identical request is already being processed.', code: 'IDEMPOTENCY_IN_FLIGHT' } });
    function refusing(status: number, body: string, opts: { idempotencyKey?: string; inFlightAsResponse?: boolean }) {
        const fetchSpy = vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }));
        const env = { API_WORKER: { fetch: fetchSpy } } as unknown as Partial<WorkerEnv>;
        return createApi(createLoadContext(env), { token: 'tok', ...opts });
    }
    const create = (api: ReturnType<typeof createApi>) =>
        api.inspections[':id'].units.$post({ param: { id: 'i1' }, json: { parentUnitId: null, kind: 'unit', type: 'unit', name: 'A' } });

    it('throws the 409 refusal as a Response when asked, so a resource route answers it as-is', async () => {
        const api = refusing(409, REFUSAL, { idempotencyKey: 'key-1', inFlightAsResponse: true });
        const thrown = await create(api).then(() => null, (e: unknown) => e);
        expect(thrown).toBeInstanceOf(Response);
        expect((thrown as Response).status).toBe(409);
        expect(await (thrown as Response).json()).toMatchObject({ error: { code: 'IDEMPOTENCY_IN_FLIGHT' } });
    });

    it('hands the failed write back as before when not asked', async () => {
        const api = refusing(409, REFUSAL, { idempotencyKey: 'key-1' });
        const res = await create(api);
        expect(res.status).toBe(409);
        expect(res.ok).toBe(false);
    });

    it('does not throw for a different 409 (a real conflict), for a refusal with no key sent, or for a later write', async () => {
        const conflict = refusing(409, JSON.stringify({ success: false, error: { message: 'Duplicate', code: 'DUPLICATE' } }), { idempotencyKey: 'key-1', inFlightAsResponse: true });
        expect((await create(conflict)).status).toBe(409);
        const unkeyed = refusing(409, REFUSAL, { inFlightAsResponse: true });
        expect((await create(unkeyed)).status).toBe(409);
        const later = refusing(409, REFUSAL, { idempotencyKey: 'key-1', inFlightAsResponse: true });
        await later.inspections[':id'].results.$get({ param: { id: 'i1' }, query: { scope: 'x' } });
        const thrown = await create(later).then(() => null, (e: unknown) => e);
        expect(thrown).toBeInstanceOf(Response);
    });

    it('lets a success through untouched', async () => {
        const api = refusing(200, '{}', { idempotencyKey: 'key-1', inFlightAsResponse: true });
        expect((await create(api)).status).toBe(200);
    });
});

