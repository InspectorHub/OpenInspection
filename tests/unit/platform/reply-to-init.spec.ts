/**
 * tenant_configs.reply_to is initialised from the owner's email when the owner
 * account is created, on both creation paths:
 *
 *  - provisioning command path: PortalProvider.handleTenantUpdate
 *    (and the shared applyAdminCredential it delegates to);
 *  - first-run setup path: StandaloneProvider.handleTenantUpdate.
 *
 * Initialize-only: a Reply-To the operator already chose is never overwritten,
 * and rotating a credential on an existing account never refills a field the
 * operator deliberately cleared.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { tenants, tenantConfigs } from '../../../server/lib/db/schema';
import { PortalProvider } from '../../../server/portal/portal.provider';
import { StandaloneProvider } from '../../../server/lib/integration/standalone';

const TENANT = '00000000-0000-0000-0000-0000000000b1';
const EMAIL = 'owner@example.com';
const acceptance = {
    actorIdentityRef: 'identity-1',
    authorityBasis: 'owner' as const,
    documents: [{ doc: 'terms', version: '2026-08-01', contentHash: 'a'.repeat(64), acceptedAt: 1_700_000_000_000 }],
};

let db: BetterSQLite3Database<typeof schema>;
let binding: D1Database;
const replyTo = async () => (await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, TENANT)).get())?.replyTo;

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    binding = toD1Binding(fix.sqlite);
    await setupSchema(fix.sqlite);
});

describe('provisioning command path (PortalProvider)', () => {
    const sync = (extra: Record<string, unknown> = {}) => new PortalProvider(binding).handleTenantUpdate({
        id: TENANT, slug: 'acme', status: 'active', adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:x:y',
        acceptance, ...extra,
    } as Parameters<PortalProvider['handleTenantUpdate']>[0]);

    it('writes the owner email into a new tenant config when the owner is created', async () => {
        await sync();
        expect(await replyTo()).toBe(EMAIL);
    });

    it('fills a blank reply_to on an existing config row', async () => {
        await db.insert(tenants).values({ id: TENANT, slug: 'acme', createdAt: new Date() });
        await db.insert(tenantConfigs).values({ tenantId: TENANT, replyTo: '  ', updatedAt: new Date() });
        await sync();
        expect(await replyTo()).toBe(EMAIL);
    });

    it('never overwrites a reply_to that is already set', async () => {
        await db.insert(tenants).values({ id: TENANT, slug: 'acme', createdAt: new Date() });
        await db.insert(tenantConfigs).values({ tenantId: TENANT, replyTo: 'desk@example.com', updatedAt: new Date() });
        await sync();
        expect(await replyTo()).toBe('desk@example.com');
    });

    it('does not refill a cleared field when a credential is rotated on an existing owner', async () => {
        await sync();
        await db.update(tenantConfigs).set({ replyTo: null }).where(eq(tenantConfigs.tenantId, TENANT));
        await sync({ adminPasswordHash: 'pbkdf2:new:hash' });
        expect(await replyTo()).toBeNull();
    });

    it('writes nothing when no admin is being created', async () => {
        await sync({ adminEmail: undefined, adminPasswordHash: undefined, acceptance: undefined });
        expect(await replyTo()).toBeUndefined();
    });
});

describe('first-run setup path (StandaloneProvider)', () => {
    const setup = () => new StandaloneProvider(binding).handleTenantUpdate({
        id: TENANT, slug: 'acme', name: 'Acme', adminEmail: EMAIL, adminPasswordHash: 'pbkdf2:x:y', adminName: 'Owner',
    } as Parameters<StandaloneProvider['handleTenantUpdate']>[0]);

    it('writes the first owner email into the tenant config', async () => {
        await setup();
        expect(await replyTo()).toBe(EMAIL);
    });

    it('never overwrites a reply_to that is already set', async () => {
        await db.insert(tenants).values({ id: TENANT, slug: 'acme', createdAt: new Date() });
        await db.insert(tenantConfigs).values({ tenantId: TENANT, replyTo: 'desk@example.com', updatedAt: new Date() });
        await setup();
        expect(await replyTo()).toBe('desk@example.com');
    });
});
