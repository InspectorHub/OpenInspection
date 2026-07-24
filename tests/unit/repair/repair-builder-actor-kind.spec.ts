/**
 * IA-35 (boundary C) — resolveBuilderAccess Path 1 assigned creator.kind='client'
 * to ANY resolvable portal token, so an agent-kind token (buyer_agent /
 * listing_agent) acted as the CLIENT on the repair-builder's write endpoints.
 * The actor's kind must come from the grant's role kind, matching the sibling
 * client-actor resolver — client/co_client → client, agent → agent, anything
 * else → rejected.
 *
 * Parity: an agent reaching the builder via a portal token (Path 1) and via an
 * agent-portal session (Path 4) must resolve to the SAME actor kind — the whole
 * point of the fix is that the two tracks stop disagreeing.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/public-access', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/public-access')>();
    return {
        ...actual,
        resolveOwnerPreviewFull: vi.fn().mockResolvedValue(null),
        resolveAgentSession: vi.fn().mockResolvedValue(null),
    };
});

import { resolveAgentSession } from '../../../server/lib/public-access';
import { makeServices, buildApp, VALID_TOKEN_ROW } from '../helpers/repair-builder-routes-harness';

/** The GET /source handler passes the resolved creator to listMineWithItems. */
async function creatorFromSource(services: ReturnType<typeof makeServices>): Promise<unknown> {
    const { app } = buildApp({ services, reportStatus: 'published', enableCustomerRepairExport: true });
    const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
    expect(res.status).toBe(200);
    const call = (services.repairRequest.listMineWithItems as ReturnType<typeof vi.fn>).mock.calls[0];
    return call?.[2];
}

describe('resolveBuilderAccess — actor kind from the grant role (IA-35)', () => {
    it('a client-role token resolves a client actor (unchanged)', async () => {
        const services = makeServices({
            portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW),
            portalAccessGetRoleKind: vi.fn().mockResolvedValue('client'),
        });
        expect(await creatorFromSource(services)).toEqual({ kind: 'client', ref: 'buyer@example.com' });
    });

    it('an agent-role token resolves an AGENT actor, not a client', async () => {
        const services = makeServices({
            portalAccessResolveToken: vi.fn().mockResolvedValue({ ...VALID_TOKEN_ROW, role: 'buyer_agent', recipientEmail: 'agent@example.com' }),
            portalAccessGetRoleKind: vi.fn().mockResolvedValue('agent'),
        });
        expect(await creatorFromSource(services)).toEqual({ kind: 'agent', ref: 'agent@example.com' });
    });

    it('an other-kind token (attorney, title company, …) is rejected — no builder actor', async () => {
        const services = makeServices({
            portalAccessResolveToken: vi.fn().mockResolvedValue({ ...VALID_TOKEN_ROW, role: 'attorney' }),
            portalAccessGetRoleKind: vi.fn().mockResolvedValue('other'),
        });
        const { app } = buildApp({ services, reportStatus: 'published' });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(401); // no builder actor → auth gate rejects
    });

    it('parity: an agent via portal token (Path 1) and via agent session (Path 4) resolve the same kind', async () => {
        // Path 1 — agent portal token.
        const viaToken = makeServices({
            portalAccessResolveToken: vi.fn().mockResolvedValue({ ...VALID_TOKEN_ROW, role: 'buyer_agent', recipientEmail: 'a@x.com' }),
            portalAccessGetRoleKind: vi.fn().mockResolvedValue('agent'),
        });
        const tokenCreator = await creatorFromSource(viaToken) as { kind: string };

        // Path 4 — agent-portal session (no portal token; session resolves the inspection).
        vi.mocked(resolveAgentSession).mockResolvedValueOnce({ userId: 'agent-user-1' } as never);
        const viaSession = makeServices({
            portalAccessResolveToken: vi.fn().mockResolvedValue(null),
            accessToInspection: vi.fn().mockResolvedValue({ tenantId: 't1' }),
        });
        const { app } = buildApp({ services: viaSession, reportStatus: 'published' });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source');
        expect(res.status).toBe(200);
        const sessionCreator = (viaSession.repairRequest.listMineWithItems as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as { kind: string };

        expect(tokenCreator.kind).toBe('agent');
        expect(sessionCreator.kind).toBe('agent');
        expect(tokenCreator.kind).toBe(sessionCreator.kind);
    });
});

describe('agentRepairAccess switch (IA-73)', () => {
    const agentToken = { ...VALID_TOKEN_ROW, role: 'buyer_agent', recipientEmail: 'agent@example.com' };

    function agentServices(setting: 'off' | 'read' | 'readwrite') {
        return makeServices({
            portalAccessResolveToken: vi.fn().mockResolvedValue(agentToken),
            portalAccessGetRoleKind: vi.fn().mockResolvedValue('agent'),
            getAgentRepairAccess: vi.fn().mockResolvedValue(setting),
        });
    }

    it('off — the agent is refused entirely (read AND write)', async () => {
        const { app } = buildApp({ services: agentServices('off'), reportStatus: 'published' });
        const read = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(read.status).toBe(401);
        const write = await app.request('/api/public/repair-builder/t1/insp1', { method: 'POST' });
        expect(write.status).toBe(401);
    });

    it('read — the agent may read but every write endpoint is 403', async () => {
        const { app } = buildApp({ services: agentServices('read'), reportStatus: 'published' });
        expect((await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1')).status).toBe(200);
        // create list
        expect((await app.request('/api/public/repair-builder/t1/insp1?token=tok1', { method: 'POST' })).status).toBe(403);
        // add item
        const addItem = await app.request('/api/public/repair-builder/t1/insp1/lists/rr1/items?token=tok1', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ findingKey: 'canned:s1:item1:x', sectionTitle: 'Roof', itemLabel: 'Shingles' }),
        });
        expect(addItem.status).toBe(403);
    });

    it('readwrite — the agent may read and write', async () => {
        // Fresh app per request: makeTwoQueryDb keys off call-count, so a second
        // request on the same app would read the wrong gate row.
        const { app: readApp } = buildApp({ services: agentServices('readwrite'), reportStatus: 'published' });
        expect((await readApp.request('/api/public/repair-builder/t1/insp1/source?token=tok1')).status).toBe(200);
        const { app: writeApp } = buildApp({ services: agentServices('readwrite'), reportStatus: 'published' });
        expect((await writeApp.request('/api/public/repair-builder/t1/insp1?token=tok1', { method: 'POST' })).status).toBe(200);
    });

    it('parity — the token track and the session track get the same action set for the same setting', async () => {
        for (const setting of ['off', 'read', 'readwrite'] as const) {
            // Token track.
            const { app: tokenApp } = buildApp({ services: agentServices(setting), reportStatus: 'published' });
            const tokenRead = (await tokenApp.request('/api/public/repair-builder/t1/insp1/source?token=tok1')).status;
            const tokenWrite = (await tokenApp.request('/api/public/repair-builder/t1/insp1?token=tok1', { method: 'POST' })).status;

            // Session track (no portal token; agent session resolves the inspection).
            vi.mocked(resolveAgentSession).mockResolvedValue({ userId: 'agent-user-1' } as never);
            const sessionSvc = makeServices({
                portalAccessResolveToken: vi.fn().mockResolvedValue(null),
                accessToInspection: vi.fn().mockResolvedValue({ tenantId: 't1' }),
                getAgentRepairAccess: vi.fn().mockResolvedValue(setting),
            });
            const { app: sessionApp } = buildApp({ services: sessionSvc, reportStatus: 'published' });
            const sessionRead = (await sessionApp.request('/api/public/repair-builder/t1/insp1/source')).status;
            const sessionWrite = (await sessionApp.request('/api/public/repair-builder/t1/insp1', { method: 'POST' })).status;

            expect({ read: tokenRead, write: tokenWrite }).toEqual({ read: sessionRead, write: sessionWrite });
        }
        vi.mocked(resolveAgentSession).mockResolvedValue(null as never);
    });
});
