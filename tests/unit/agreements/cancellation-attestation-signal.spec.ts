/**
 * #84 — editing or deleting an agreement template can revoke the workspace's
 * cancellation-fee attestation, and the caller has to be told BY THE RESPONSE.
 *
 * #83 answered this with a banner in the template editor. A banner is a UI, and
 * `PUT /api/admin/agreements/{id}` and `DELETE /api/admin/agreements/{id}` are
 * also MCP tools (`updateTenantAgreement` / `deleteTenantAgreement`, both
 * `admin`/`extended`). The MCP tool is NOT a second handler: the DO rebuilds the
 * HTTP request and dispatches it into the same in-process API, then hands the
 * response body back to the model verbatim. So whatever these two responses say
 * is what every caller learns — and today they say nothing.
 *
 * WHY THE SIGNAL IS MEASURED, NOT DERIVED. The handler does not decide whether a
 * revocation happened by re-implementing "is this the attested template" — that
 * is the third copy of an invalidation rule that already exists once, in
 * `getCancellationAttestation()`. It reads that function before the mutation and
 * again after, and reports the transition. A rule restated cannot drift from
 * itself only because there is nothing to restate.
 *
 * THE FIELD IS ALWAYS PRESENT, never omitted when false. An absent field and a
 * forgotten field are the same bytes; a caller (or a gate) cannot tell "this
 * operation revoked nothing" from "this route never learned to say". The
 * negative controls below assert `false`, not absence, for exactly that reason.
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
import type { HonoConfig } from '../../../server/types/hono';
import { AgreementService } from '../../../server/services/agreement.service';
import { BrandingService } from '../../../server/services/branding.service';
import { AppError } from '../../../server/lib/errors';
import { MCP_MAX_RESULT_BYTES } from '../../../server/lib/mcp/result-limits';
import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT = '11111111-1111-4111-8111-111111111111';
/** The template the attestation names. */
const ATTESTED = '33333333-3333-4333-8333-333333333333';
/** A second template in the same workspace — the positive control. */
const OTHER = '44444444-4444-4444-8444-444444444444';

let db: BetterSQLite3Database<typeof schema>;
let branding: BrandingService;
let app: OpenAPIHono<HonoConfig>;

const ENV = { DB: {}, JWT_SECRET: 'test-secret' };
// Settled at teardown by the helper. A no-op stub still lets the promise RUN --
// it only removes any way to await it, which is how a run with every test
// passing could still exit 1 on an unhandled teardown rejection.
const EXEC = makeExecutionContext().ctx;

function buildApp() {
    const built = new OpenAPIHono<HonoConfig>();
    built.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    const services = {
        agreement: new AgreementService({} as D1Database, { jwtSecret: 'test-secret' }),
        branding,
        auditLog: { append: vi.fn(async () => {}) },
    } as unknown as HonoConfig['Variables']['services'];
    built.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'u1' } as never);
        c.set('services', services);
        await next();
    });
    built.route('/api/admin', adminRoutes);
    return built;
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    branding = new BrandingService({} as D1Database);
    app = buildApp();

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.agreements).values([
        { id: ATTESTED, tenantId: TENANT, name: 'Residential', content: 'Cancel 24h ahead or pay 50%.', version: 1, createdAt: new Date() },
        { id: OTHER, tenantId: TENANT, name: 'Commercial', content: 'Other terms.', version: 1, createdAt: new Date() },
    ]);
});

/** PUT the template unchanged — `updateAgreement` compares nothing and bumps anyway. */
function put(id: string, body: { name: string; content: string }) {
    return app.request(`/api/admin/agreements/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }, ENV, EXEC);
}

function del(id: string) {
    return app.request(`/api/admin/agreements/${id}`, { method: 'DELETE' }, ENV, EXEC);
}

type Effects = { effects?: { cancellationFeeAttestationRevoked?: boolean } };

describe('agreement writes report the cancellation-attestation they revoked', () => {
    describe('PUT /agreements/{id} — the updateTenantAgreement tool', () => {
        it('says it revoked the attestation, even for a byte-identical save', async () => {
            await branding.attestCancellationClause(TENANT, ATTESTED);
            expect(await branding.getCancellationAttestation(TENANT)).not.toBeNull();

            const res = await put(ATTESTED, { name: 'Residential', content: 'Cancel 24h ahead or pay 50%.' });

            // The two facts side by side: the attestation is gone, and the
            // response said so. Either one alone is the bug.
            expect(await branding.getCancellationAttestation(TENANT)).toBeNull();
            expect(await res.json() as Effects).toMatchObject({
                effects: { cancellationFeeAttestationRevoked: true },
            });
        });

        it('says it revoked NOTHING when a different template is edited', async () => {
            await branding.attestCancellationClause(TENANT, ATTESTED);

            const res = await put(OTHER, { name: 'Commercial', content: 'Edited.' });

            expect(await branding.getCancellationAttestation(TENANT)).not.toBeNull();
            expect(await res.json() as Effects).toMatchObject({
                effects: { cancellationFeeAttestationRevoked: false },
            });
        });

        it('says it revoked NOTHING when the attestation had already drifted', async () => {
            // A previous edit already cleared it. Reporting a second revocation
            // would send the author to Settings to re-confirm something this
            // save did not take away.
            await branding.attestCancellationClause(TENANT, ATTESTED);
            await put(ATTESTED, { name: 'Residential', content: 'First edit.' });
            expect(await branding.getCancellationAttestation(TENANT)).toBeNull();

            const res = await put(ATTESTED, { name: 'Residential', content: 'Second edit.' });

            expect(await res.json() as Effects).toMatchObject({
                effects: { cancellationFeeAttestationRevoked: false },
            });
        });

        it('says it revoked NOTHING when the workspace never attested at all', async () => {
            const res = await put(ATTESTED, { name: 'Residential', content: 'Edited.' });
            expect(await res.json() as Effects).toMatchObject({
                effects: { cancellationFeeAttestationRevoked: false },
            });
        });
    });

    describe('DELETE /agreements/{id} — the deleteTenantAgreement tool', () => {
        it('says it revoked the attestation when the attested template is deleted', async () => {
            await branding.attestCancellationClause(TENANT, ATTESTED);

            const res = await del(ATTESTED);

            expect(await branding.getCancellationAttestation(TENANT)).toBeNull();
            expect(await res.json() as Effects).toMatchObject({
                effects: { cancellationFeeAttestationRevoked: true },
            });
        });

        it('says it revoked NOTHING when a different template is deleted', async () => {
            await branding.attestCancellationClause(TENANT, ATTESTED);

            const res = await del(OTHER);

            expect(await branding.getCancellationAttestation(TENANT)).not.toBeNull();
            expect(await res.json() as Effects).toMatchObject({
                effects: { cancellationFeeAttestationRevoked: false },
            });
        });
    });

    /**
     * The signal has to survive the transport it was written for. The MCP tool
     * handler slices the response body at `MCP_MAX_RESULT_BYTES` before handing
     * it to the model, and the PUT body echoes the whole agreement — a long
     * agreement pushes anything after it past the cut. So `effects` is
     * serialised BEFORE `data`, and this is the assertion that keeps it there:
     * move the key back to the end of the response object and this goes red
     * while every test above stays green.
     */
    it('keeps the signal inside the slice an MCP client actually receives', async () => {
        const huge = 'A very long clause. '.repeat(Math.ceil(MCP_MAX_RESULT_BYTES / 20) + 100);
        await db.update(schema.agreements).set({ content: huge })
            .where(eq(schema.agreements.id, ATTESTED));
        await branding.attestCancellationClause(TENANT, ATTESTED);

        const res = await put(ATTESTED, { name: 'Residential', content: huge });
        const body = await res.text();

        expect(body.length).toBeGreaterThan(MCP_MAX_RESULT_BYTES);
        expect(body.slice(0, MCP_MAX_RESULT_BYTES))
            .toContain('"cancellationFeeAttestationRevoked":true');
    });
});
