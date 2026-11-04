/**
 * The inspector pre-sign stores the company's countersignature, then appends `agreement.inspector_signed`. A failed append cannot be
 * retried by the staff member (the envelope is no longer pending), so it is logged and the call still succeeds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import adminAgreementsRoutes from '../../../server/api/admin/admin-agreements';
import { AuditLogService } from '../../../server/services/audit-log.service';
import { AppError } from '../../../server/lib/errors';
import { logger } from '../../../server/lib/logger';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const ENV_ID = 'env-own';
const SIGNATURE = `data:image/png;base64,${'A'.repeat(80)}`;

describe('the inspector pre-sign and its audit row', () => {
    let db: ReturnType<typeof createTestDb>['db'];

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        await db.insert(schema.agreements).values({ id: 'agr-1', tenantId: TENANT, name: 'A', content: 'x', version: 1, createdAt: new Date() } as never);
        await db.insert(schema.agreementRequests).values({
            id: ENV_ID, tenantId: TENANT, inspectionId: INSP.own, agreementId: 'agr-1', clientEmail: 'c@example.test', status: 'pending', createdAt: new Date(),
        } as never);
    });
    afterEach(() => vi.restoreAllMocks());

    function call() {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', 'owner');
            c.set('user', { sub: USERS.owner, role: 'owner', tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            await next();
        });
        app.route('/api/admin', adminAgreementsRoutes as never);
        return app.request(`/api/admin/agreement-requests/${ENV_ID}/inspector-sign`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatureBase64: SIGNATURE }),
        }, { DB: {}, JWT_SECRET: 'a-secret-long-enough-for-the-keys' } as never);
    }

    it('succeeds and keeps the countersignature when the audit append throws, and raises an alert with ids only', async () => {
        vi.spyOn(AuditLogService.prototype, 'append').mockRejectedValue(new Error('Failed query: insert into "esign_audit_logs"\nparams: owner@example.test'));
        const alert = vi.spyOn(logger, 'alert').mockImplementation(() => undefined);
        const res = await call();
        expect(res.status).toBe(200);
        const row = await db.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, ENV_ID)).get();
        expect(row?.inspectorSignatureBase64).toBe(SIGNATURE);
        const logged = alert.mock.calls.find((c) => c[0] === 'audit_append_inspector_signed_failed');
        expect(logged).toBeTruthy();
        expect(JSON.stringify(logged)).toContain(ENV_ID);
        expect(JSON.stringify(logged)).not.toContain('owner@example.test');
    });

    it('control: when the append works the call succeeds and nothing is logged as a failure', async () => {
        vi.spyOn(AuditLogService.prototype, 'append').mockResolvedValue({ id: 'a', hash: 'h' });
        const alert = vi.spyOn(logger, 'alert').mockImplementation(() => undefined);
        expect((await call()).status).toBe(200);
        expect(alert.mock.calls.some((c) => c[0] === 'audit_append_inspector_signed_failed')).toBe(false);
    });
});
