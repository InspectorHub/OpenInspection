/**
 * A postal-code placeholder is read as "none", never refused.
 *
 * A write queued on a device before this rule existed (an offline import replays inspection.create through the real create route) may
 * carry addressZip "-" or " ". It must still apply, and the stored value must be null, so the audit export's knowledge check never
 * sees a placeholder as a postal code.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { app } from '../../../server/index';
import { registerApiAppLoader } from '../../../server/lib/api-app';
import { applyOutbox } from '../../../server/services/offline-import-outbox';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { postalOrNull } from '../../../server/lib/validations/postal-code';
import { CreateInspectionSchema } from '../../../server/lib/validations/inspection/crud';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { OutboxEntry } from '@core/offline-package';
import { createHarness, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const ctxStub = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('postalOrNull', () => {
    it('keeps a real code (trimmed) and turns a placeholder into null; absent stays absent and null stays null', () => {
        expect(postalOrNull('  78701 ')).toBe('78701');
        expect(postalOrNull('K1A 0B1')).toBe('K1A 0B1');
        expect(postalOrNull('78701-1234')).toBe('78701-1234');
        for (const placeholder of ['-', ' ', '--', '', ' - ', '0', '.']) expect(postalOrNull(placeholder), JSON.stringify(placeholder)).toBeNull();
        expect(postalOrNull(undefined)).toBeUndefined();
        expect(postalOrNull(null)).toBeNull();
    });

    it('in the create schema: a placeholder parses to null, a real code is kept, and an absent key is not added', () => {
        const base = { propertyAddress: '12 Harbor Lane', templateId: 'tpl-1' };
        const parse = (extra: Record<string, unknown>) => CreateInspectionSchema.safeParse({ ...base, ...extra });
        const placeholder = parse({ addressZip: '-' });
        expect(placeholder.success).toBe(true);
        expect(placeholder.success && placeholder.data.addressZip).toBeNull();
        const real = parse({ addressZip: ' 78701 ' });
        expect(real.success && real.data.addressZip).toBe('78701');
        const absent = parse({});
        expect(absent.success).toBe(true);
        expect(absent.success && 'addressZip' in absent.data && absent.data.addressZip !== undefined).toBe(false);
    });
});

describe('a replayed create that carries a placeholder postal code', () => {
    let h: Harness;
    beforeEach(async () => {
        h = await createHarness('standalone');
        await h.db.insert(schema.templates).values({ id: 'tpl-1', tenantId: TENANT_ID, name: 'Standard', schema: { schemaVersion: 2, sections: [] }, version: 1, createdAt: new Date() });
        registerApiAppLoader(async () => app);
    });
    afterEach(() => h.close());

    it('applies, and stores null; a real code beside it is stored as sent', async () => {
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring);
        const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
        const c = {
            env: h.env,
            executionCtx: ctxStub,
            get: (key: string) => (key === 'tenantId' ? TENANT_ID : key === 'user' ? { sub: OWNER_ID } : undefined),
            req: { url: 'https://app.platform.test/api/client/import', header: (name: string) => headers[name] },
        } as unknown as Context<HonoConfig>;
        const PLACEHOLDER_ID = '66666666-0000-4000-8000-0000000000b1';
        const REAL_ID = '66666666-0000-4000-8000-0000000000b2';
        const entries: OutboxEntry[] = [
            { idempotencyKey: 'key-placeholder', op: 'inspection.create', payload: { id: PLACEHOLDER_ID, propertyAddress: '14 Harbor Lane', templateId: 'tpl-1', addressZip: '-' } },
            { idempotencyKey: 'key-real', op: 'inspection.create', payload: { id: REAL_ID, propertyAddress: '15 Harbor Lane', templateId: 'tpl-1', addressZip: '78701' } },
        ];
        const result = await applyOutbox(c, entries, { tolerateRefusals: false });
        expect(result).toEqual({ applied: 2, skipped: 0, failed: [] });
        const rows = await h.db.select({ id: schema.inspections.id, zip: schema.inspections.addressZip }).from(schema.inspections)
            .where(eq(schema.inspections.tenantId, TENANT_ID)).all();
        expect(rows.find((r) => r.id === PLACEHOLDER_ID)?.zip).toBeNull();
        expect(rows.find((r) => r.id === REAL_ID)?.zip).toBe('78701');
    });
});
