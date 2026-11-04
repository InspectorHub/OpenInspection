import { describe, it, expect } from 'vitest';
import { InspectionSharingService } from '../../../server/services/inspection/inspection-sharing.service';

/**
 * The 30-day KV share token (a bridge from before per-recipient portal tokens) carries the role of whoever it was minted
 * for. A value written before roles existed has none and counts as an agent link; an unknown role resolves to nothing.
 */
function kvStub() {
    const store = new Map<string, string>();
    const kv = {
        put: async (k: string, v: string) => { store.set(k, v); },
        get: async (k: string) => store.get(k) ?? null,
    } as unknown as KVNamespace;
    return { store, kv };
}

describe('agent view token role', () => {
    it('a legacy two-part value resolves as an agent link', async () => {
        const { store, kv } = kvStub();
        store.set('agent_view_token:old', 'insp1:t1');
        const svc = new InspectionSharingService({} as D1Database, undefined, undefined, kv);
        expect(await svc.resolveAgentViewToken('old')).toEqual({ inspectionId: 'insp1', tenantId: 't1', role: 'agent' });
    });

    it('stores and returns the role the token was minted with', async () => {
        const { store, kv } = kvStub();
        store.set('agent_view_token:viewonly', 'insp1:t1:client');
        const svc = new InspectionSharingService({} as D1Database, undefined, undefined, kv);
        expect(await svc.resolveAgentViewToken('viewonly')).toEqual({ inspectionId: 'insp1', tenantId: 't1', role: 'client' });
    });

    it('an unknown role or a malformed value resolves to nothing', async () => {
        const { store, kv } = kvStub();
        store.set('agent_view_token:odd', 'insp1:t1:admin');
        store.set('agent_view_token:bad', 'insp1');
        const svc = new InspectionSharingService({} as D1Database, undefined, undefined, kv);
        expect(await svc.resolveAgentViewToken('odd')).toBeNull();
        expect(await svc.resolveAgentViewToken('bad')).toBeNull();
        expect(await svc.resolveAgentViewToken('missing')).toBeNull();
    });
});
