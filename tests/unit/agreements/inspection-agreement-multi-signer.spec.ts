/**
 * IA-65 — POST /api/inspections/:id/agreement-requests, multi-party send.
 *
 * Sending an agreement to more than one party used to require the tenant-wide
 * Library page, whose endpoint is owner/manager-only. So the surface an
 * inspector actually works from — the inspection — could reach exactly one
 * signer, and an inspector could not add a co-client at all. This exercises the
 * REAL mounted route (RBAC + zod + handler) against in-memory SQLite, with the
 * email service spied so we can assert who was actually written to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { AgreementService } from '../../../server/services/agreement.service';
import { PeopleService } from '../../../server/services/people.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const CLIENT_CONTACT_ID = '00000000-0000-0000-0000-0000000000c1';
const AGR_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'acme';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let sendAgreementRequest: ReturnType<typeof vi.fn>;

function buildApp(role = 'manager') {
    const app = new OpenAPIHono<HonoConfig>();
    sendAgreementRequest = vi.fn().mockResolvedValue(undefined);
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            agreement: new AgreementService({} as D1Database, { jwtSecret: 'test-secret' }),
            people: new PeopleService({ DB: {} as D1Database }),
            email: { sendAgreementRequest } as never,
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

const ENV = { DB: {}, APP_BASE_URL: 'https://acme.example.com' } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

async function post(body: unknown, role = 'manager') {
    const req = new Request(`https://acme.example.com/api/inspections/${INSP_ID}/agreement-requests`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return buildApp(role).fetch(req, ENV, CTX);
}

const emailedAddresses = () => sendAgreementRequest.mock.calls.map((c) => c[0] as string).sort();

const signersFor = (requestId: string) =>
    db.select().from(schema.agreementSigners).where(eq(schema.agreementSigners.requestId, requestId)).all();

describe('POST /api/inspections/:id/agreement-requests — multi-party send (IA-65)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT_CONTACT_ID, tenantId: TENANT, type: 'client', name: 'Jane',
            email: 'jane@example.com', createdAt: new Date(),
        });
        await db.insert(schema.inspectionPeople).values({
            id: `ip_${INSP_ID}_client`, tenantId: TENANT, inspectionId: INSP_ID,
            contactId: CLIENT_CONTACT_ID, roleProfileId: roleProfileId('client'), createdAt: new Date(),
        });
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT, name: 'Standard Agreement', content: 'AGREEMENT BODY', version: 1, createdAt: new Date(),
        });
    });

    it('creates one envelope with every signer and emails each of them their own link', async () => {
        const res = await post({
            signers: [
                { name: 'Jane Client', email: 'jane@example.com', role: 'client' },
                { name: 'Sam Co-Client', email: 'sam@example.com', role: 'co_client' },
                { name: 'Ada Agent', email: 'ada@example.com', role: 'agent' },
            ],
            completionPolicy: 'all',
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { id: string; signerCount: number; addedSigners: number } };
        expect(body.data.signerCount).toBe(3);

        const rows = await signersFor(body.data.id);
        expect(rows.map((s) => s.role).sort()).toEqual(['agent', 'client', 'co_client']);
        // Each signer's link is minted from their own token — a shared link
        // would attribute whoever clicked it to the first signer.
        expect(new Set(rows.map((s) => s.tokenHash)).size).toBe(3);
        expect(emailedAddresses()).toEqual(['ada@example.com', 'jane@example.com', 'sam@example.com']);

        const env = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.id, body.data.id)).get();
        expect(env?.completionPolicy).toBe('all');
    });

    it('an inspector can send to multiple parties (the capability is not admin-only)', async () => {
        const res = await post({
            signers: [
                { name: 'Jane Client', email: 'jane@example.com', role: 'client' },
                { name: 'Sam Co-Client', email: 'sam@example.com', role: 'co_client' },
            ],
        }, 'inspector');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { signerCount: number } };
        expect(body.data.signerCount).toBe(2);
    });

    it('a later send adds the new party to the live envelope instead of dropping them', async () => {
        const first = await post({ signers: [{ name: 'Jane Client', email: 'jane@example.com', role: 'client' }] });
        const firstBody = (await first.json()) as { data: { id: string; addedSigners: number } };
        expect(firstBody.data.addedSigners).toBe(0);

        const second = await post({
            signers: [
                { name: 'Jane Client', email: 'jane@example.com', role: 'client' },
                { name: 'Sam Co-Client', email: 'sam@example.com', role: 'co_client' },
            ],
            completionPolicy: 'all',
        });
        const secondBody = (await second.json()) as { data: { id: string; signerCount: number; addedSigners: number } };

        // Same envelope — one inspection holds one live agreement.
        expect(secondBody.data.id).toBe(firstBody.data.id);
        expect(secondBody.data.addedSigners).toBe(1);
        expect(secondBody.data.signerCount).toBe(2);
        expect((await signersFor(firstBody.data.id)).map((s) => s.email).sort())
            .toEqual(['jane@example.com', 'sam@example.com']);
    });

    it('a send that names nobody new still reaches the client (plain resend)', async () => {
        const first = await post({ signers: [{ name: 'Jane Client', email: 'jane@example.com', role: 'client' }] });
        const { data } = (await first.json()) as { data: { id: string } };

        const res = await post({ signers: [{ name: 'Jane Client', email: 'jane@example.com', role: 'client' }] });
        expect(res.status).toBe(200);
        expect(emailedAddresses()).toEqual(['jane@example.com']);
        expect(await signersFor(data.id)).toHaveLength(1);
    });

    it('skips a signer who already signed — a resend must not re-ask them', async () => {
        const first = await post({
            signers: [
                { name: 'Jane Client', email: 'jane@example.com', role: 'client' },
                { name: 'Sam Co-Client', email: 'sam@example.com', role: 'co_client' },
            ],
            completionPolicy: 'all',
        });
        const { data } = (await first.json()) as { data: { id: string } };
        const jane = (await signersFor(data.id)).find((s) => s.email === 'jane@example.com')!;
        await db.update(schema.agreementSigners)
            .set({ status: 'signed', signedAt: new Date() })
            .where(eq(schema.agreementSigners.id, jane.id));

        await post({ signers: [{ name: 'Sam Co-Client', email: 'sam@example.com', role: 'co_client' }] });
        expect(emailedAddresses()).toEqual(['sam@example.com']);
    });

    it('falls back to the primary client when no signers are given (old single-recipient send)', async () => {
        const res = await post({});
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { clientEmail: string; signerCount: number } };
        expect(body.data.clientEmail).toBe('jane@example.com');
        expect(body.data.signerCount).toBe(1);
        expect(emailedAddresses()).toEqual(['jane@example.com']);
    });
});
