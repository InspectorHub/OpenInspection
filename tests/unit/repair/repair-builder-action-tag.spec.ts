/**
 * #275 — who may author the repair-vs-replace action tag, and whether the tag
 * survives the route on the way to the service.
 *
 * ⚠️ These assertions are on the HTTP STATUS, through the real router. A
 * service-level test would be green against a route that never enforces the
 * rule, and `createRoutesStub` runs no middleware at all — the same shape that
 * has already produced a passing suite over an unguarded route in this repo.
 *
 * The rule refuses the FIELD, not the request: an inspector on owner-preview
 * creates lists and adds untagged items today (`repair-access.ts` resolves that
 * JWT to `kind: 'inspector'` with `readwrite`), so the "no tag" cases below are
 * as load-bearing as the refusals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/public-access', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/public-access')>();
    return {
        ...actual,
        resolveOwnerPreviewFull: vi.fn().mockResolvedValue(null),
        resolveAgentSession: vi.fn().mockResolvedValue(null),
    };
});

import { resolveOwnerPreviewFull } from '../../../server/lib/public-access';
import { makeServices, buildApp, VALID_TOKEN_ROW } from '../helpers/repair-builder-routes-harness';

const ITEM_BASE = { findingKey: 'canned:s1:i1:roof', sectionTitle: 'Roof', itemLabel: 'Shingles' };

/** Services resolving a CLIENT actor (portal token, the common path). */
function clientServices() {
    return makeServices({
        portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW),
        portalAccessGetRoleKind: vi.fn().mockResolvedValue('client'),
    });
}

/** Services resolving an AGENT actor under the given tenant repair policy. */
function agentServices(setting: 'read' | 'readwrite') {
    return makeServices({
        portalAccessResolveToken: vi.fn().mockResolvedValue({ ...VALID_TOKEN_ROW, role: 'buyer_agent', recipientEmail: 'agent@example.com' }),
        portalAccessGetRoleKind: vi.fn().mockResolvedValue('agent'),
        getAgentRepairAccess: vi.fn().mockResolvedValue(setting),
    });
}

/**
 * Services resolving an INSPECTOR actor. Path 3 of resolveBuilderAccess: no
 * portal token, no legacy token, owner-preview JWT verifies.
 */
function inspectorServices() {
    vi.mocked(resolveOwnerPreviewFull).mockResolvedValueOnce({ tenantId: 't1', userId: 'u-inspector' } as never);
    return makeServices({ portalAccessResolveToken: vi.fn().mockResolvedValue(null) });
}

function addItem(app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, body: unknown, token = true) {
    return app.request(`/api/public/repair-builder/t1/insp1/lists/rr1/items${token ? '?token=tok1' : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function patchItem(app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, body: unknown, token = true) {
    return app.request(`/api/public/repair-builder/t1/insp1/lists/rr1/items/item1${token ? '?token=tok1' : ''}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    vi.mocked(resolveOwnerPreviewFull).mockResolvedValue(null as never);
});

describe('#275 — the inspector may not author the action tag', () => {
    it('POST items with a tag from an inspector is 403', async () => {
        const services = inspectorServices();
        const { app } = buildApp({ services, reportStatus: 'published' });
        const res = await addItem(app, { ...ITEM_BASE, repairActionTag: 'replace' }, false);
        expect(res.status).toBe(403);
        // The write must not reach the service at all — a 403 with the row
        // already inserted would be the worst of both.
        expect(services.repairRequest.addItem).not.toHaveBeenCalled();
    });

    it('PATCH item with a tag from an inspector is 403', async () => {
        const services = inspectorServices();
        const { app } = buildApp({ services, reportStatus: 'published' });
        const res = await patchItem(app, { repairActionTag: 'fund' }, false);
        expect(res.status).toBe(403);
        expect(services.repairRequest.updateItem).not.toHaveBeenCalled();
    });

    it('an inspector adding an UNTAGGED item still succeeds — the field is refused, not the request', async () => {
        const services = inspectorServices();
        const { app } = buildApp({ services, reportStatus: 'published' });
        const res = await addItem(app, ITEM_BASE, false);
        expect(res.status).toBe(200);
        expect(services.repairRequest.addItem).toHaveBeenCalled();
    });

    it('an explicit null tag from an inspector is not a tag, so it passes', async () => {
        const services = inspectorServices();
        const { app } = buildApp({ services, reportStatus: 'published' });
        const res = await addItem(app, { ...ITEM_BASE, repairActionTag: null }, false);
        expect(res.status).toBe(200);
    });

    it('the refusal sits AFTER the edit guard: a read-only agent is refused for being read-only', async () => {
        // Order matters. If the tag branch ran first, an unauthorized caller
        // would learn about the field from the error it gets back.
        const { app } = buildApp({ services: agentServices('read'), reportStatus: 'published' });
        const res = await addItem(app, { ...ITEM_BASE, repairActionTag: 'repair' });
        expect(res.status).toBe(403);
        const body = await res.json() as { error?: { message?: string } };
        expect(body.error?.message).toMatch(/read-only/i);
    });
});

describe('#275 — the buyer and their agent may author it', () => {
    it('a client tag reaches addItem', async () => {
        const services = clientServices();
        const { app } = buildApp({ services, reportStatus: 'published' });
        expect((await addItem(app, { ...ITEM_BASE, repairActionTag: 'fund' })).status).toBe(200);
        expect(services.repairRequest.addItem).toHaveBeenCalledWith(
            't1', 'rr1', expect.objectContaining({ repairActionTag: 'fund' }),
        );
    });

    it('an agent tag reaches addItem', async () => {
        const services = agentServices('readwrite');
        const { app } = buildApp({ services, reportStatus: 'published' });
        expect((await addItem(app, { ...ITEM_BASE, repairActionTag: 'replace' })).status).toBe(200);
        expect(services.repairRequest.addItem).toHaveBeenCalledWith(
            't1', 'rr1', expect.objectContaining({ repairActionTag: 'replace' }),
        );
    });

    it('a client tag reaches updateItem', async () => {
        const services = clientServices();
        const { app } = buildApp({ services, reportStatus: 'published' });
        expect((await patchItem(app, { repairActionTag: 'other' })).status).toBe(200);
        expect(services.repairRequest.updateItem).toHaveBeenCalledWith(
            't1', 'insp1', 'rr1', 'item1', { repairActionTag: 'other' },
        );
    });

    it('an ABSENT tag on PATCH leaves the key out of the patch — it must not null a stored tag', async () => {
        // The assertion is about the KEY MISSING, not about its value: a patch
        // carrying `repairActionTag: null` would clear a tag the buyer set while
        // they were only editing their note.
        const services = clientServices();
        const { app } = buildApp({ services, reportStatus: 'published' });
        expect((await patchItem(app, { note: 'just the note' })).status).toBe(200);
        const patch = (services.repairRequest.updateItem as ReturnType<typeof vi.fn>).mock.calls[0]?.[4] as Record<string, unknown>;
        expect('repairActionTag' in patch).toBe(false);
    });

    it('an explicit null on PATCH clears it', async () => {
        const services = clientServices();
        const { app } = buildApp({ services, reportStatus: 'published' });
        expect((await patchItem(app, { repairActionTag: null })).status).toBe(200);
        const patch = (services.repairRequest.updateItem as ReturnType<typeof vi.fn>).mock.calls[0]?.[4] as Record<string, unknown>;
        expect(patch.repairActionTag).toBeNull();
    });

    it('a value outside the vocabulary is a 400 at the request boundary', async () => {
        const services = clientServices();
        const { app } = buildApp({ services, reportStatus: 'published' });
        expect((await addItem(app, { ...ITEM_BASE, repairActionTag: 'further_study' })).status).toBe(400);
        expect(services.repairRequest.addItem).not.toHaveBeenCalled();
    });
});
