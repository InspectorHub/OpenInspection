/**
 * Tier 1: sending an agreement for signature. An email that has left cannot be
 * recalled, and this one carries a per-signer signing link — so a retried send
 * puts a second "please sign your inspection agreement" in a client's inbox
 * with a link that also works, and the operator has no way to tell which one
 * the client used.
 *
 * The envelope itself is NOT the exposure. `AgreementService.findOrCreate` is
 * find-or-create by construction, so a duplicate send returns the same
 * requestId and writes no second envelope even with nothing guarding it. What
 * repeats is everything AFTER it: one outbound email per signer, and the
 * `request.sent` entry in the tamper-evident audit chain, which is supposed to
 * be the record of how many times this envelope was actually mailed out.
 *
 * The route is tenant-authenticated, so the global mount in server/index.ts
 * already spans it. These specs prove the whole tail sits inside that span.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../../server/api/admin';
import { AgreementService } from '../../../server/services/agreement.service';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INSP_ID = '22222222-2222-4222-8222-222222222222';
const AGR_ID = '33333333-3333-4333-8333-333333333333';

let db: BetterSQLite3Database<typeof schema>;
let emailSend: ReturnType<typeof vi.fn>;
let auditAppend: ReturnType<typeof vi.fn>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    const services = {
        agreement: new AgreementService({} as D1Database, { jwtSecret: 'test-secret' }),
        email: { sendAgreementRequest: emailSend },
        auditLog: { append: auditAppend, verifyChain: vi.fn(async () => ({ valid: true })) },
    } as unknown as HonoConfig['Variables']['services'];
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'u1' } as never);
        c.set('services', services);
        await next();
    });
    // The mounted shape: tenant on the context (the JWT middleware's job in
    // production), then the guard, then the router.
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/admin', adminRoutes);
    return app;
}

const ENV = { DB: {}, JWT_SECRET: 'test-secret', APP_BASE_URL: 'https://app.test' };
const EXEC = {
    waitUntil: (p: Promise<unknown>) => { void Promise.resolve(p).catch(() => {}); },
    passThroughOnException: () => {},
} as ExecutionContext;

const BODY = {
    agreementId: AGR_ID,
    inspectionId: INSP_ID,
    completionPolicy: 'all',
    signers: [
        { name: 'Jane', email: 'jane@test.com', role: 'client' },
        { name: 'John', email: 'john@test.com', role: 'co_client' },
    ],
};

function send(key: string | null, body: unknown = BODY) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().request('/api/admin/agreements/send', {
        method: 'POST', headers, body: JSON.stringify(body),
    }, ENV, EXEC);
}

const sentEvents = () => auditAppend.mock.calls.filter(([, , event]) => event === 'request.sent');

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    emailSend = vi.fn(async () => {});
    auditAppend = vi.fn(async () => {});

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'a', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01',
        status: 'requested', paymentStatus: 'unpaid', price: 50000,
        agreementRequired: true, paymentRequired: false, createdAt: new Date(),
    });
    await db.insert(schema.agreements).values({
        id: AGR_ID, tenantId: TENANT, name: 'Standard Agreement',
        content: 'Agreement text...', version: 1, createdAt: new Date(),
    });
});

describe("POST '/api/admin/agreements/send' — replay does not re-mail the signers", () => {
    it('emails each signer exactly once across two sends under one key', async () => {
        const first = await send('send-1');
        const second = await send('send-1');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        // Two signers, one send: two emails, not four.
        expect(emailSend).toHaveBeenCalledTimes(2);
        expect(emailSend.mock.calls.map(([to]) => to).sort())
            .toEqual(['jane@test.com', 'john@test.com']);
    });

    it('writes ONE request.sent entry into the audit chain', async () => {
        // The chain is the record of how many times this envelope was mailed.
        // A second entry says the client was contacted twice, which — if the
        // send really was a duplicate — is a lie in a tamper-evident log.
        await send('send-1');
        await send('send-1');
        expect(sentEvents()).toHaveLength(1);
    });

    it('replays the original response, flagged, with the same requestId', async () => {
        const first = await send('send-1');
        const second = await send('send-1');
        const a = await first.json() as { data: { requestId: string } };
        const b = await second.json() as { data: { requestId: string } };

        expect(b.data.requestId).toBe(a.data.requestId);
        expect(second.headers.get('Idempotency-Replayed')).toBe('true');
        expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    });

    it('CHARACTERIZATION: the envelope is find-or-create, guard or no guard', async () => {
        // Not evidence for the guard — stated so nobody later reads it as such.
        // AgreementService.findOrCreate is why a duplicate send does not leave
        // two envelopes behind. It is also why the requestId assertion above is
        // NOT the containment proof: the emails and the audit entry are.
        await send('send-1');
        await send('send-2');
        const envelopes = await db.select().from(schema.agreementRequests)
            .where(eq(schema.agreementRequests.tenantId, TENANT)).all();
        expect(envelopes).toHaveLength(1);
    });

    it('sends again under a fresh key — a deliberate re-send still reaches the signers', async () => {
        await send('send-1');
        await send('send-2');
        expect(emailSend).toHaveBeenCalledTimes(4);
        expect(sentEvents()).toHaveLength(2);
    });

    it('refuses the key when the signer list changed under it', async () => {
        await send('send-1');
        const res = await send('send-1', {
            ...BODY,
            signers: [{ name: 'Mallory', email: 'mallory@test.com', role: 'client' }],
        });

        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
        // And Mallory was never mailed a signing link. Unguarded this is not a
        // no-op that merely wastes an email: findOrCreate MERGES the new signer
        // into the live envelope ("findOrCreate merged signers", added: 1), so a
        // mis-keyed retry adds a party to an agreement already out for signature.
        expect(emailSend.mock.calls.map(([to]) => to)).not.toContain('mallory@test.com');
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.tenantId, TENANT)).all();
        expect(signers.map(s => s.email).sort()).toEqual(['jane@test.com', 'john@test.com']);
    });
});
