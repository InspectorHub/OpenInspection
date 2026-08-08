/**
 * #275 — repair-note quick phrases, server side.
 *
 * Two obligations live here:
 *
 *  1. The READ path. `GET /api/public/repair-builder/:tenant/:id/source` is the
 *     only call either client surface makes, so if the phrases are not on that
 *     response they exist nowhere the buttons can reach. It is also a PUBLIC,
 *     token-authenticated route reading a tenant-config row, so what it exposes
 *     is a whitelist, asserted here field by field.
 *
 *  2. NULL is not []. "Never configured" shows the seeded defaults; an empty
 *     array shows no buttons at all. The route must carry that distinction
 *     verbatim — substituting defaults server-side removes the tenant's only
 *     off switch, and the defaults look intentional, so nobody would notice.
 *
 * The caps are validated by `UpdateBrandingSchema` (the body of
 * `POST /api/admin/branding`), not by a setter — there is no setter; the write
 * goes straight through BrandingService.writeConfig. So they are asserted where
 * they are enforced.
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

// Import AFTER mock registration
// eslint-disable-next-line import/order
import { makeServices, makeTwoQueryDb, buildApp, VALID_TOKEN_ROW } from '../helpers/repair-builder-routes-harness';
// eslint-disable-next-line import/order
import { UpdateBrandingSchema } from '../../../server/lib/validations/admin/settings';

/** Config row the tenant-flag gate AND the quick-phrase read both see. */
function tenantConfigRow(repairQuickPhrases: string[] | null) {
    return { enableCustomerRepairExport: true, repairQuickPhrases };
}

function buildSourceApp(repairQuickPhrases: string[] | null) {
    return buildApp({
        services: makeServices({
            portalAccessResolveToken: vi.fn().mockResolvedValue(VALID_TOKEN_ROW),
            listMine: vi.fn().mockResolvedValue([]),
        }),
        dbFactory: () => makeTwoQueryDb({ reportStatus: 'published' }, tenantConfigRow(repairQuickPhrases)),
    });
}

async function readSource(repairQuickPhrases: string[] | null) {
    const { app } = buildSourceApp(repairQuickPhrases);
    const res = await app.request('/api/public/repair-builder/t1/insp1/source?token=tok1');
    expect(res.status).toBe(200);
    return (await res.json()) as { data: Record<string, unknown> };
}

describe('GET /repair-builder/:tenant/:id/source — quickPhrases', () => {
    it('carries the tenant-configured phrases to the client', async () => {
        const body = await readSource(['Repair requested', 'Replacement requested']);
        expect(body.data.quickPhrases).toEqual(['Repair requested', 'Replacement requested']);
    });

    it('reports NULL as null, not as the seeded defaults', async () => {
        // Resolving the defaults belongs to the client: they are localized
        // product strings. If the server substituted them here, the wire could
        // no longer say "never configured" and the [] off switch would be
        // indistinguishable from it.
        const body = await readSource(null);
        expect(body.data.quickPhrases).toBeNull();
    });

    it('reports an emptied list as [] — the tenant turned the buttons OFF', async () => {
        const body = await readSource([]);
        expect(body.data.quickPhrases).toEqual([]);
    });

    it('exposes ONLY defects, mine and quickPhrases — no other tenant config', async () => {
        // A public token route reading tenant_configs is a whitelist, not a
        // projection of whatever the row happens to hold.
        const body = await readSource(['Repair requested']);
        expect(Object.keys(body.data).sort()).toEqual(['defects', 'mine', 'quickPhrases']);
    });
});

describe('UpdateBrandingSchema.repairQuickPhrases', () => {
    it('rejects a phrase too long for the button row', () => {
        const result = UpdateBrandingSchema.safeParse({ repairQuickPhrases: ['x'.repeat(41)] });
        expect(result.success).toBe(false);
    });

    it('rejects more phrases than the row can show', () => {
        const result = UpdateBrandingSchema.safeParse({ repairQuickPhrases: Array(9).fill('x') });
        expect(result.success).toBe(false);
    });

    it('rejects an empty-string phrase (a blank button is unclickable)', () => {
        expect(UpdateBrandingSchema.safeParse({ repairQuickPhrases: [''] }).success).toBe(false);
    });

    it('accepts an empty array — that is how the tenant turns the buttons off', () => {
        const result = UpdateBrandingSchema.safeParse({ repairQuickPhrases: [] });
        expect(result.success).toBe(true);
        expect(result.success && result.data.repairQuickPhrases).toEqual([]);
    });

    it('leaves the key ABSENT when the caller omits it, so a partial save cannot clear the list', () => {
        // The `.default()` trap: a schema default here would let any save that
        // does not carry the field overwrite a configured list. Assert the
        // absence of the KEY, not the value.
        const result = UpdateBrandingSchema.safeParse({ companyName: 'Acme' });
        expect(result.success).toBe(true);
        expect(result.success && Object.hasOwn(result.data, 'repairQuickPhrases')).toBe(false);
    });
});
