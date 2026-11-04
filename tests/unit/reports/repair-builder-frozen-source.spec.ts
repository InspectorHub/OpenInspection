/**
 * The repair builder lists the defects of the report the client was sent.
 *
 * `GET /repair-builder/:tenant/:id/source` hands a client every defect of the published report to build a
 * repair request from. It reads the list at the latest published version, so a finding the inspector adds or
 * removes in the working copy afterwards does not appear in (or vanish from) a client's request.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('../../../server/lib/repair-access', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    resolveBuilderAccess: async () => ({ tenantId: 'tenant-1', creator: { kind: 'client' } }),
}));
vi.mock('../../../server/lib/repair-gates', async (importActual) => ({
    ...(await importActual<Record<string, unknown>>()),
    runBuilderGate: async () => null,
    loadQuickPhrases: async () => [],
}));

import repairBuilder from '../../../server/api/repair-builder';

function run(published: { versionNumber: number } | null) {
    const getRepairList = vi.fn(async () => ({ defects: [{
        source: 'canned', sectionId: 's', sectionTitle: 'Roof', itemId: 'i', itemLabel: 'Shingles', defectTitle: 'Curling',
        comment: 'c', location: null, category: 'safety', severityBucket: 'defect', trade: null, recommendationId: null,
    }] }));
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('services', {
            inspection: { getRepairList },
            reportVersion: { getLatestPublished: vi.fn(async () => published) },
            repairRequest: { listMineWithItems: vi.fn(async () => []) },
        } as never);
        await next();
    });
    app.route('/api/public', repairBuilder);
    return { getRepairList, get: () => app.request('/api/public/repair-builder/acme/insp-1/source?token=t', {}, { DB: {} }) };
}

describe('repair builder source', () => {
    it('reads the defect list at the latest published version', async () => {
        const t = run({ versionNumber: 5 });
        const res = await t.get();
        expect(res.status).toBe(200);
        expect(((await res.json()) as { data: { defects: unknown[] } }).data.defects).toHaveLength(1);
        expect(t.getRepairList).toHaveBeenCalledWith('insp-1', 'tenant-1', 5);
    });

    it('reads the report as it is when no version has been frozen', async () => {
        const t = run(null);
        expect((await t.get()).status).toBe(200);
        expect(t.getRepairList).toHaveBeenCalledWith('insp-1', 'tenant-1', undefined);
    });
});
