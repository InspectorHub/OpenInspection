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
