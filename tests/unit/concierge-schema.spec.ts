import { describe, it, expect } from 'vitest';
import { inspections, tenantConfigs, conciergeConfirmTokens } from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';

/**
 * Agent Accounts A3 — Schema verification for concierge booking.
 *
 * Verifies:
 *   1. inspections.concierge_status (nullable text)
 *   2. tenant_configs.concierge_review_required (boolean default false)
 *   3. concierge_confirm_tokens table with expected columns + index
 */
describe('concierge schema — A3', () => {
    it('inspections has conciergeStatus column mapping concierge_status', () => {
        const t = inspections as unknown as Record<string, { name: string }>;
        expect(t.conciergeStatus?.name).toBe('concierge_status');
    });

    it('tenant_configs has conciergeReviewRequired column mapping concierge_review_required', () => {
        const t = tenantConfigs as unknown as Record<string, { name: string }>;
        expect(t.conciergeReviewRequired?.name).toBe('concierge_review_required');
    });

    it('concierge_confirm_tokens table is exported with token primary key', () => {
        expect(conciergeConfirmTokens).toBeDefined();
        const t = conciergeConfirmTokens as unknown as Record<string, { name: string }>;
        expect(t.token?.name).toBe('token');
        expect(t.inspectionId?.name).toBe('inspection_id');
        expect(t.tenantId?.name).toBe('tenant_id');
        expect(t.clientEmail?.name).toBe('client_email');
        expect(t.expiresAt?.name).toBe('expires_at');
        expect(t.confirmedAt?.name).toBe('confirmed_at');
        expect(t.createdAt?.name).toBe('created_at');
    });

    it('migration 0058 applies cleanly and the columns/table are queryable', async () => {
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);

        // Insert a tenant + tenant_config row, then read back the new column default.
        const TENANT = '00000000-0000-0000-0000-000000000a01';
        await fixture.db.insert(schema.tenants).values({
            id: TENANT,
            name: 'A3 Test Co',
            subdomain: 'a3test',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });
        await fixture.db.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            updatedAt: new Date(),
        });

        const cfg = await fixture.db.select().from(schema.tenantConfigs).all();
        expect(cfg.length).toBeGreaterThan(0);
        // Default for concierge_review_required is 0 (false) per migration.
        expect(!!cfg[0].conciergeReviewRequired).toBe(false);

        // Insert a token row to confirm the new table is wired and queryable.
        await fixture.db.insert(schema.inspections).values({
            id: 'insp-a3',
            tenantId: TENANT,
            propertyAddress: '1 Main St',
            date: '2026-06-15',
            status: 'pending',
            paymentStatus: 'unpaid',
            createdAt: new Date(),
        });
        await fixture.db.insert(schema.conciergeConfirmTokens).values({
            token: 'tok-a3-1',
            inspectionId: 'insp-a3',
            tenantId: TENANT,
            clientEmail: 'sarah@example.com',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
        });
        const tokens = await fixture.db.select().from(schema.conciergeConfirmTokens).all();
        expect(tokens.length).toBe(1);
        expect(tokens[0].token).toBe('tok-a3-1');
        expect(tokens[0].confirmedAt).toBeNull();
    });
});
