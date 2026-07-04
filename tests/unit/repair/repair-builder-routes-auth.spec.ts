/**
 * TDD tests for GET /api/public/repair-builder/:tenant/:id/source — AUTH gate.
 *
 * Gates:
 *  1. Auth — portal token / legacy agent token / owner-preview (one must succeed)
 *  2. Publish — report must be published (raw drizzle gate)
 *  3. Tenant flag — enableCustomerRepairExport must be true
 *
 * Happy path returns { data: { defects: [...], mine: [...] } }.
 *
 * Harness pattern mirrors repair-request-get.spec.ts:
 *  - vi.mock drizzle-orm/d1 so handler's drizzle(c.env.DB) returns our fake
 *  - stub c.set('services', ...) with the needed service methods
 *  - set c.env = { DB: {} }
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

import { resolveOwnerPreviewFull, resolveAgentSession } from '../../../server/lib/public-access';

// Import AFTER mock registration
// eslint-disable-next-line import/order
import { makeServices, buildApp, VALID_TOKEN_ROW } from '../helpers/repair-builder-routes-harness';

describe('GET /api/public/repair-builder/:tenant/:id/source', () => {

    it('200 with defects + mine when published report + valid client token', async () => {
        const getRepairList = vi.fn().mockResolvedValue({
            defects: [
                {
                    sectionId:        's1',
                    sectionTitle:     'Roof',
                    itemId:           'item1',
                    itemLabel:        'Shingles',
                    comment:          'Missing shingles',
                    category:         'safety' as const,
                    source:           'canned' as const,
                    recommendationId: 'missing-shingles',
                },
            ],
        });
        const listMine = vi.fn().mockResolvedValue([{ id: 'rr1' }]);
        const resolveToken = vi.fn().mockResolvedValue(VALID_TOKEN_ROW);

        const { app } = buildApp({
            services: makeServices({ portalAccessResolveToken: resolveToken, getRepairList, listMine }),
            reportStatus: 'published',
            enableCustomerRepairExport: true,
        });

        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(200);

        const body = await res.json() as {
            success: boolean;
            data: { defects: unknown[]; mine: unknown[] };
        };
        expect(body.success).toBe(true);
        expect(body.data.defects).toHaveLength(1);
        expect((body.data.defects[0] as Record<string, unknown>).findingKey).toBe('canned:s1:item1:missing-shingles');
        expect((body.data.defects[0] as Record<string, unknown>).category).toBe('safety');
        expect(body.data.mine).toHaveLength(1);

        // Confirm getRepairList was called with the authoritative tenantId from the token
        expect(getRepairList).toHaveBeenCalledWith('insp1', 't1');
        // Confirm listMine was called with a client creator
        expect(listMine).toHaveBeenCalledWith(
            't1',
            'insp1',
            { kind: 'client', ref: 'buyer@example.com' },
        );
    });

    it('401 when no token is supplied', async () => {
        const { app } = buildApp({ reportStatus: 'published' });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source');
        expect(res.status).toBe(401);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('401 when the portal token maps to a different inspection', async () => {
        const wrongRow = { ...VALID_TOKEN_ROW, inspectionId: 'other-insp' };
        const { app } = buildApp({ portalTokenRow: wrongRow, reportStatus: 'published' });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(401);
    });

    it('403 NOT_PUBLISHED when report is in_progress and valid client token', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            reportStatus: 'in_progress',
            enableCustomerRepairExport: true,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('403 NOT_PUBLISHED when report is submitted (not yet published)', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            reportStatus: 'submitted',
            enableCustomerRepairExport: true,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('403 FORBIDDEN when tenant flag is OFF (published report, valid token)', async () => {
        const { app } = buildApp({
            portalTokenRow: VALID_TOKEN_ROW,
            reportStatus: 'published',
            enableCustomerRepairExport: false,
        });
        const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('FORBIDDEN');
    });

    it('200 via legacy agent-view-token fallback', async () => {
        // Portal token resolves null, but legacy agent token resolves the inspection
        const resolveAgentViewToken = vi.fn().mockResolvedValue({
            inspectionId: 'insp1',
            tenantId:     't2',
        });
        const listMine = vi.fn().mockResolvedValue([]);

        const { app } = buildApp({
            services: makeServices({ resolveAgentViewToken, listMine }),
            reportStatus: 'published',
            enableCustomerRepairExport: true,
        });

        const res = await app.request('/api/public/repair-builder/t2/insp1/source?token=kvtok');
        expect(res.status).toBe(200);
        // Creator should be {kind:'agent', ref: token string}
        expect(listMine).toHaveBeenCalledWith('t2', 'insp1', { kind: 'agent', ref: 'kvtok' });
    });

    it('403 NOT_PUBLISHED for owner-preview on an unpublished (in_progress) report', async () => {
        // Simulate owner-preview: portal + agent tokens both null, but
        // resolveOwnerPreviewFull (mocked at module level) resolves a valid session.
        vi.mocked(resolveOwnerPreviewFull).mockResolvedValueOnce({
            tenantId: 't1',
            userId:   'user-owner',
        });

        const { app } = buildApp({
            // No portal token — both path-1 and path-2 will resolve null.
            reportStatus: 'in_progress',
            enableCustomerRepairExport: true,
        });

        // Owner-preview uses Bearer JWT in Authorization header, not ?token=
        const res = await app.request(
            '/api/public/repair-builder/t1/insp1/source',
            { headers: { Authorization: 'Bearer owner-jwt' } },
        );

        expect(res.status).toBe(403);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_PUBLISHED');
    });

    it('200 via authenticated agent-portal session (tokenless dashboard link)', async () => {
        // Portal + legacy tokens null; owner-preview null; agent session resolves a
        // logged-in agent who IS associated with the inspection. The authoritative
        // tenantId comes from accessToInspection (the inspection row), NOT the URL.
        vi.mocked(resolveAgentSession).mockResolvedValueOnce({ userId: 'agent-user-1' });
        const accessToInspection = vi.fn().mockResolvedValue({ tenantId: 't-real' });
        const listMine = vi.fn().mockResolvedValue([]);

        const { app } = buildApp({
            services: makeServices({ accessToInspection, listMine }),
            reportStatus: 'published',
            enableCustomerRepairExport: true,
        });

        // URL tenant is 't-WRONG' on purpose — must be ignored.
        const res = await app.request(
            '/api/public/repair-builder/t-WRONG/insp1/source',
            { headers: { Authorization: 'Bearer agent-jwt' } },
        );
        expect(res.status).toBe(200);
        // Association check is keyed on the agent userId + inspection id (not URL tenant).
        expect(accessToInspection).toHaveBeenCalledWith('agent-user-1', 'insp1');
        // creator.ref is the stable agent userId; tenantId is the authoritative one.
        expect(listMine).toHaveBeenCalledWith('t-real', 'insp1', { kind: 'agent', ref: 'agent-user-1' });
    });

    it('401 when agent session is valid but agent is NOT associated with the inspection', async () => {
        vi.mocked(resolveAgentSession).mockResolvedValueOnce({ userId: 'agent-user-1' });
        const accessToInspection = vi.fn().mockResolvedValue(null); // no claim
        const listMine = vi.fn().mockResolvedValue([]);

        const { app } = buildApp({
            services: makeServices({ accessToInspection, listMine }),
            reportStatus: 'published',
            enableCustomerRepairExport: true,
        });

        const res = await app.request(
            '/api/public/repair-builder/t1/insp1/source',
            { headers: { Authorization: 'Bearer agent-jwt' } },
        );
        expect(res.status).toBe(401);
        const body = await res.json() as { success: false; error: { code: string } };
        expect(body.error.code).toBe('UNAUTHORIZED');
        expect(accessToInspection).toHaveBeenCalledWith('agent-user-1', 'insp1');
        expect(listMine).not.toHaveBeenCalled();
    });
});
