import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { AgreementService } from '../../../server/services/agreement.service';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import agreementRoutes from '../../../server/api/bookings/agreement';

/**
 * IA-44 — `/checkout` holds a SIGNER token, but the Hub hand-off
 * (app/lib/portal-exchange.ts resolvePortalSession) needs a PORTAL token. The
 * exchange therefore happens server-side, inside the existing checkout endpoint
 * that already verifies the signer — deliberately NOT behind a new,
 * independently-callable exchange route.
 *
 * What is asserted: the minted portal token belongs to the SIGNER'S OWN email,
 * carries the signer's client/co_client role, is idempotent across reloads, and
 * is never minted for a non-client signer.
 */

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = '00000000-0000-0000-0000-000000000010';
const AGR = '00000000-0000-0000-0000-000000000020';
const SECRET = 'test-jwt-secret';

describe('IA-44 — checkout mints the signer a portal token', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };
    let portalAccess: PortalAccessService;

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {}, JWT_SECRET: SECRET };
            c.set('services', {
                agreement: new AgreementService({} as D1Database, { jwtSecret: SECRET }),
                portalAccess,
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', agreementRoutes);
        return app;
    }

    async function seed() {
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT);
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, companyName: 'Acme Inspections', primaryColor: '#ff5500',
            createdAt: new Date(), updatedAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St', clientName: 'Jane',
            clientEmail: 'jane@test.com', date: '2026-06-01', status: 'requested',
            paymentStatus: 'unpaid', price: 50000, agreementRequired: true,
            paymentRequired: true, createdAt: new Date(),
        });
        await db.insert(schema.agreements).values({
            id: AGR, tenantId: TENANT, name: 'Standard Agreement',
            content: 'Agreement text', version: 1, createdAt: new Date(),
        });
    }

    async function envelopeWithSigners(signers: Array<{ name: string; email: string; role: string }>) {
        const svc = new AgreementService({} as D1Database, { jwtSecret: SECRET });
        return svc.findOrCreate(TENANT, INSP, {
            signers: signers as never,
            completionPolicy: 'all',
        });
    }

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await seed();
        portalAccess = new PortalAccessService({} as D1Database, { jwtSecret: SECRET });
    });

    afterEach(() => sqlite.close());

    async function getCheckout(token: string) {
        const res = await buildApp().request(`/api/public/checkout/${token}`);
        const body = await res.json() as { data?: { portalToken?: string | null } };
        return { status: res.status, portalToken: body.data?.portalToken ?? null };
    }

    it('returns a portal token bound to the CLIENT signer own email + client role', async () => {
        const { token } = await envelopeWithSigners([{ name: 'Jane', email: 'jane@test.com', role: 'client' }]);
        const { status, portalToken } = await getCheckout(token);
        expect(status).toBe(200);
        expect(portalToken).toBeTruthy();

        const grant = await portalAccess.resolveToken(portalToken!);
        expect(grant).not.toBeNull();
        expect(grant!.recipientEmail).toBe('jane@test.com');
        expect(grant!.inspectionId).toBe(INSP);
        expect(grant!.tenantId).toBe(TENANT);
        expect(grant!.role).toBe('client');
    });

    it('is idempotent — reloading checkout returns the SAME portal token', async () => {
        const { token } = await envelopeWithSigners([{ name: 'Jane', email: 'jane@test.com', role: 'client' }]);
        const first = await getCheckout(token);
        const second = await getCheckout(token);
        expect(second.portalToken).toBe(first.portalToken);
        const rows = await db.select().from(schema.inspectionAccessTokens).all();
        expect(rows).toHaveLength(1);
    });

    it('a co_client signer gets their OWN token, never the other signer grant', async () => {
        const svc = new AgreementService({} as D1Database, { jwtSecret: SECRET });
        const env = await svc.findOrCreate(TENANT, INSP, {
            signers: [
                { name: 'Jane', email: 'jane@test.com', role: 'client' },
                { name: 'John', email: 'john@test.com', role: 'co_client' },
            ] as never,
            completionPolicy: 'all',
        });
        const signers = await svc.listSigners(TENANT, env.requestId);
        const john = signers.find((s) => s.email === 'john@test.com')!;
        const johnToken = await svc.getSignerLink(TENANT, env.requestId, john.id);

        const { portalToken } = await getCheckout(johnToken);
        const grant = await portalAccess.resolveToken(portalToken!);
        expect(grant!.recipientEmail).toBe('john@test.com');
        expect(grant!.role).toBe('co_client');
    });

    it('an AGENT signer gets NO portal token (agents have no client hub)', async () => {
        const { token } = await envelopeWithSigners([{ name: 'Ann', email: 'ann@agency.com', role: 'agent' }]);
        const { status, portalToken } = await getCheckout(token);
        expect(status).toBe(200);
        expect(portalToken).toBeNull();
        const rows = await db.select().from(schema.inspectionAccessTokens).all();
        expect(rows).toHaveLength(0);
    });
});
