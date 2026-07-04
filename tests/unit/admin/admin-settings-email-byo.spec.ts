/**
 * Email provider abstraction (#195) — admin-settings emailByoProvider round-trip.
 *
 * Verifies:
 *   1. tenantConfigs schema has emailByoProvider column mapped to email_byo_provider.
 *   2. Default value is 'resend' (schema default).
 *   3. Updating to 'sendgrid' and reading back returns 'sendgrid' (PATCH → GET round-trip).
 *   4. A fresh tenant with no tenant_configs row returns 'resend' default from the GET handler.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { OpenAPIHono } from '@hono/zod-openapi';
import { tenantConfigs, tenants } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import adminRoutes from '../../../server/api/admin';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000e0b710';

async function setupFixture() {
    const fixture = createTestDb();
    await setupSchema(fixture.sqlite);
    await fixture.db.insert(schema.tenants).values({
        id: TENANT,
        name: 'Email BYO Test Co',
        slug: 'email-byo-test',
        status: 'active',
        deploymentMode: 'shared',
        tier: 'free',
        createdAt: new Date(),
    });
    return fixture;
}

describe('tenantConfigs.emailByoProvider — schema column', () => {
    it('has emailByoProvider column mapped to email_byo_provider', () => {
        const t = tenantConfigs as unknown as Record<string, { name: string }>;
        expect(t.emailByoProvider?.name).toBe('email_byo_provider');
    });
});

describe('tenantConfigs.emailByoProvider — PATCH → GET round-trip', () => {
    it('default is "resend" when a row is inserted without specifying the column', async () => {
        const fixture = await setupFixture();
        await fixture.db.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            updatedAt: new Date(),
        });

        const [row] = await fixture.db
            .select({ v: schema.tenantConfigs.emailByoProvider })
            .from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT));
        expect(row?.v).toBe('resend');
    });

    it('PATCH to "sendgrid" then GET returns "sendgrid"', async () => {
        const fixture = await setupFixture();
        await fixture.db.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            updatedAt: new Date(),
        });

        // Simulate PATCH emailByoProvider = 'sendgrid'
        await fixture.db
            .update(schema.tenantConfigs)
            .set({ emailByoProvider: 'sendgrid' })
            .where(eq(schema.tenantConfigs.tenantId, TENANT));

        const [after] = await fixture.db
            .select({ v: schema.tenantConfigs.emailByoProvider })
            .from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT));
        expect(after?.v).toBe('sendgrid');
    });

    it('PATCH to "postmark" then GET returns "postmark"', async () => {
        const fixture = await setupFixture();
        await fixture.db.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            updatedAt: new Date(),
        });

        await fixture.db
            .update(schema.tenantConfigs)
            .set({ emailByoProvider: 'postmark' })
            .where(eq(schema.tenantConfigs.tenantId, TENANT));

        const [after] = await fixture.db
            .select({ v: schema.tenantConfigs.emailByoProvider })
            .from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT));
        expect(after?.v).toBe('postmark');
    });

    it('PATCH to "mailgun" then GET returns "mailgun"', async () => {
        const fixture = await setupFixture();
        await fixture.db.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            updatedAt: new Date(),
        });

        await fixture.db
            .update(schema.tenantConfigs)
            .set({ emailByoProvider: 'mailgun' })
            .where(eq(schema.tenantConfigs.tenantId, TENANT));

        const [after] = await fixture.db
            .select({ v: schema.tenantConfigs.emailByoProvider })
            .from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT));
        expect(after?.v).toBe('mailgun');
    });
});

describe('GET /api/admin/tenant-config — emailByoProvider', () => {
    // Drives the real route handler (not an inline reimplementation of its
    // `?? 'resend'` fallback) — see admin-communication.spec.ts for the
    // buildApp pattern this mirrors.
    function buildApp(getBranding: (...args: unknown[]) => unknown) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', 'owner');
            c.set('tenantId', 't1');
            c.set('services', { branding: { getBranding } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/admin', adminRoutes);
        return { app, env: { JWT_SECRET: 'x' } };
    }

    it('defaults to "resend" when config has no emailByoProvider set', async () => {
        const { app, env } = buildApp(async () => ({}));
        const res = await app.request('/api/admin/tenant-config', {}, env);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { emailByoProvider: string } };
        expect(body.data.emailByoProvider).toBe('resend');
    });

    it('passes through "sendgrid" when the config has it set', async () => {
        const { app, env } = buildApp(async () => ({ emailByoProvider: 'sendgrid' }));
        const res = await app.request('/api/admin/tenant-config', {}, env);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { emailByoProvider: string } };
        expect(body.data.emailByoProvider).toBe('sendgrid');
    });
});
