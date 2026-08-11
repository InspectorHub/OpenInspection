import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import {
    AI_CAPS_CONFIG_KEY,
    narrowAiTierCaps,
    readTenantAiCaps,
    writeTenantAiCaps,
} from '../../../server/features/plan-quota/ai-caps';
import { BrandingService } from '../../../server/services/branding.service';
import { IntegrationConfigSchema } from '../../../server/api/admin/admin-config';

/**
 * Where a delivered AI allowance is stored, and the two properties that make it
 * safe to keep in a column the tenant also writes to.
 *
 * The caps are a platform control on a paying customer: portal's console
 * records who set one, and core enforces it. Sharing `integration_config` with
 * tenant-owned settings is only defensible while a tenant can neither clobber
 * the value by saving their own settings nor write one for themselves — so
 * both are asserted here rather than described in a comment.
 */
describe('AI cap storage', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let testD1: D1Database;
    const T = 'tenant-caps';

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        (mockDrizzle as never as { mockReturnValue: (v: unknown) => void }).mockReturnValue(testDb);
        testD1 = toRawD1(setup.sqlite);
        await testDb.insert(schema.tenants).values({
            id: T, slug: 'caps-co', tier: 'pro', status: 'active', createdAt: new Date(),
        });
    });

    describe('narrowing', () => {
        it('keeps only cappable metrics with non-negative integer values', () => {
            expect(narrowAiTierCaps({
                pro: { ai_translate: 500, ai_assist: 0, ai_hologram: 7, ai_translate_byo: 9 },
            })).toEqual({ pro: { ai_translate: 500, ai_assist: 0 } });
        });

        it('drops values that are not a count', () => {
            // A cap arriving as "500" or 12.5 or -1 is a producer bug. Coercing
            // it would enforce a number nobody set; dropping it leaves the tier
            // unenforced, which is the state the operator can see and fix.
            expect(narrowAiTierCaps({ pro: { ai_translate: '500' } })).toBeUndefined();
            expect(narrowAiTierCaps({ pro: { ai_translate: 12.5 } })).toBeUndefined();
            expect(narrowAiTierCaps({ pro: { ai_translate: -1 } })).toBeUndefined();
        });

        it('reads an empty set as unconfigured, not as "configured to nothing"', () => {
            expect(narrowAiTierCaps({})).toBeUndefined();
            expect(narrowAiTierCaps({ pro: {} })).toBeUndefined();
            expect(narrowAiTierCaps(null)).toBeUndefined();
        });
    });

    describe('the column', () => {
        it('round-trips a cap, keyed by the tier it was computed for', async () => {
            expect(await writeTenantAiCaps(testD1, T, { pro: { ai_translate: 500 } })).toBe('applied');
            expect(await readTenantAiCaps(testD1, T)).toEqual({ pro: { ai_translate: 500 } });
        });

        it('reads a tenant with no config row, and a corrupt blob, as unconfigured', async () => {
            expect(await readTenantAiCaps(testD1, T)).toBeUndefined();
            await testDb.insert(schema.tenantConfigs)
                .values({ tenantId: T, integrationConfig: 'not json', updatedAt: new Date() });
            expect(await readTenantAiCaps(testD1, T)).toBeUndefined();
        });

        it('refuses to write for a tenant that does not exist', async () => {
            expect(await writeTenantAiCaps(testD1, 'ghost', { pro: { ai_assist: 1 } })).toBe('tenant-not-found');
        });

        it('clears back to unconfigured', async () => {
            await writeTenantAiCaps(testD1, T, { pro: { ai_translate: 500 } });
            await writeTenantAiCaps(testD1, T, undefined);
            expect(await readTenantAiCaps(testD1, T)).toBeUndefined();
        });
    });

    describe('the tenant cannot touch it', () => {
        it('survives a tenant saving their own integration settings', async () => {
            await writeTenantAiCaps(testD1, T, { pro: { ai_translate: 500 } });

            // The Settings-UI write path, verbatim: it merges over the stored
            // object. If it ever starts overwriting, the operator's cap
            // disappears the next time the tenant saves an unrelated field —
            // silently, and in the tenant's favour.
            await new BrandingService(testD1).updateIntegrationConfig(T, { appBaseUrl: 'https://tenant.example' });

            expect(await readTenantAiCaps(testD1, T)).toEqual({ pro: { ai_translate: 500 } });
            const cfg = await new BrandingService(testD1).getIntegrationConfig(T);
            expect((cfg as Record<string, unknown>)['appBaseUrl']).toBe('https://tenant.example');
        });

        it('cannot be written through the tenant-facing config route', () => {
            // The route validates its body against a CLOSED object, so the
            // reserved key never reaches the merge. This is the assertion that
            // keeps the shared column honest: make that schema permissive and a
            // workspace owner can raise their own allowance.
            const parsed = IntegrationConfigSchema.parse({
                appBaseUrl: 'https://tenant.example',
                [AI_CAPS_CONFIG_KEY]: { pro: { ai_translate: 999_999 } },
            });
            expect(parsed).toEqual({ appBaseUrl: 'https://tenant.example' });
            expect(AI_CAPS_CONFIG_KEY in parsed).toBe(false);
        });
    });
});
