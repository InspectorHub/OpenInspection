/**
 * The sibling of POST /api/admin/agreements/send, and the reason it is its own
 * commit rather than a footnote: the inspection workspace's "Send agreement"
 * button posts HERE, not to the admin route, and the two share
 * `emailSignersTheirLinks` precisely because they had already drifted into
 * mailing different links once (IA-65).
 *
 * A shared helper is not shared containment. Covering one endpoint and calling
 * the behaviour verified would leave the button most inspectors actually press
 * unguarded — so the same replay evidence is asserted against this route
 * directly, through the real mounted router.
 *
 * As on the admin route, the envelope is find-or-create and therefore not the
 * exposure. What repeats is the outbound email carrying each signer's personal
 * signing link.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { AgreementService } from '../../../server/services/agreement.service';
import { PeopleService } from '../../../server/services/people.service';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const CLIENT_CONTACT_ID = '00000000-0000-0000-0000-0000000000c1';
const AGR_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'acme';

let db: BetterSQLite3Database<typeof schema>;
let sendAgreementRequest: ReturnType<typeof vi.fn>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
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
    // The mounted shape: tenant on the context first, then the guard.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
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

function requestSignature(key: string | null, body: unknown = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().fetch(
        new Request(`https://acme.example.com/api/inspections/${INSP_ID}/agreement-requests`, {
            method: 'POST', headers, body: JSON.stringify(body),
        }),
        ENV, CTX,
    );
}

const mailedTo = () => sendAgreementRequest.mock.calls.map(([to]) => to as string);

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    sendAgreementRequest = vi.fn().mockResolvedValue(undefined);

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: SLUG, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
        clientName: 'Jane', clientEmail: 'jane@example.com', date: '2026-06-01',
        status: 'requested', paymentStatus: 'unpaid', price: 50000,
        agreementRequired: false, paymentRequired: false, createdAt: new Date(),
    });
    await seedRoleProfiles(db, TENANT, new Date(1));
    await db.insert(schema.contacts).values({
        id: CLIENT_CONTACT_ID, tenantId: TENANT, type: 'client', name: 'Jane',
        email: 'jane@example.com', createdAt: new Date(),
    });
    await db.insert(schema.inspectionPeople).values({
        id: `ip_${INSP_ID}_client`, tenantId: TENANT, inspectionId: INSP_ID,
        contactId: CLIENT_CONTACT_ID, roleProfileId: `crp_${TENANT}_client`, createdAt: new Date(),
    });
    await db.insert(schema.agreements).values({
        id: AGR_ID, tenantId: TENANT, name: 'Standard Agreement',
        content: 'AGREEMENT BODY', version: 1, createdAt: new Date(),
    });
});

describe("POST '/api/inspections/{id}/agreement-requests' — replay does not re-mail", () => {
    it('emails the client once across two sends under one key', async () => {
        const first = await requestSignature('agr-1');
        const second = await requestSignature('agr-1');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(mailedTo()).toEqual(['jane@example.com']);
    });

    it('replays the original response, flagged', async () => {
        const first = await requestSignature('agr-1');
        const second = await requestSignature('agr-1');

        expect(await second.json()).toEqual(await first.clone().json());
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    });

    it('sends again under a fresh key — a deliberate re-send still reaches the client', async () => {
        await requestSignature('agr-1');
        await requestSignature('agr-2');
        expect(mailedTo()).toEqual(['jane@example.com', 'jane@example.com']);
    });

    it('refuses the key when the recipient changed under it', async () => {
        await requestSignature('agr-1');
        const res = await requestSignature('agr-1', {
            signers: [{ name: 'Mallory', email: 'mallory@example.com', role: 'client' }],
        });

        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
        // Unguarded, findOrCreate MERGES the new signer into the envelope that
        // is already out for signature — so this is not a wasted email, it is a
        // party added to a live agreement.
        expect(mailedTo()).not.toContain('mallory@example.com');
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.tenantId, TENANT)).all();
        expect(signers.map(s => s.email)).toEqual(['jane@example.com']);
    });
});
