import { vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq, asc } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { AgreementService } from '../../../server/services/agreement.service';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const INSP_ID = '00000000-0000-0000-0000-000000000010';
export const AGR_ID = '00000000-0000-0000-0000-000000000020';
export const JWT_SECRET = 'test-secret';

export const FAKE_ENV = {
    DB: {},
    APP_NAME: 'OpenInspection',
    APP_BASE_URL: 'https://example.test',
} as unknown as HonoConfig['Bindings'];

export function makeExecCtx() {
    const pending: Promise<unknown>[] = [];
    const ctx = {
        waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => {})); },
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    return { ctx, settle: () => Promise.all(pending) };
}

export interface Stubs {
    auditAppend?: ReturnType<typeof vi.fn>;
    automationTrigger?: ReturnType<typeof vi.fn>;
    notificationCreate?: ReturnType<typeof vi.fn>;
    emailConfirm?: ReturnType<typeof vi.fn>;
    workflowCreate?: ReturnType<typeof vi.fn>;
}

export function buildApp(db: BetterSQLite3Database<typeof schema>, stubs: Stubs = {}) {
    const auditAppend = stubs.auditAppend ?? vi.fn().mockResolvedValue({ id: 'a', hash: 'h' });
    const automationTrigger = stubs.automationTrigger ?? vi.fn().mockResolvedValue(undefined);
    const notificationCreate = stubs.notificationCreate ?? vi.fn().mockResolvedValue(undefined);
    const emailConfirm = stubs.emailConfirm ?? vi.fn().mockResolvedValue(undefined);
    const workflowCreate = stubs.workflowCreate ?? vi.fn().mockResolvedValue(undefined);

    const agreement = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });

    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });

    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT_ID);
        c.set('services', {
            agreement,
            inspection: new InspectionService({} as D1Database, undefined, new ScopedDB(db as never, TENANT_ID)),
            auditLog: { append: auditAppend },
            automation: { trigger: automationTrigger },
            notification: { createForAllAdmins: notificationCreate },
            email: { sendAgreementSignedConfirmation: emailConfirm },
        } as unknown as HonoConfig['Variables']['services']);
        (c.env as Record<string, unknown>).SIGN_COMPLETION_WORKFLOW = { create: workflowCreate };
        await next();
    });
    app.route('/', inspectionsRoutes);
    (mockDrizzle as any).mockReturnValue(db);

    return { app, auditAppend, automationTrigger, notificationCreate, emailConfirm, workflowCreate };
}

export async function seedBase(db: BetterSQLite3Database<typeof schema>, opts: { withTemplate?: boolean } = {}) {
    await db.insert(schema.tenants).values({
        id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    } as any);
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
        clientEmail: 'jane@test.com', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
        price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
    } as any);
    if (opts.withTemplate ?? true) {
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'ORIGINAL agreement text', version: 1, createdAt: new Date(),
        } as any);
    }
}

/** Seed a 2-signer envelope directly via the service. */
export async function createTwoSignerEnvelope(db: BetterSQLite3Database<typeof schema>, policy: 'all' | 'one' = 'all') {
    const svc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
    const r = await svc.findOrCreate(TENANT_ID, INSP_ID, {
        signers: [
            { name: 'Jane', email: 'jane@test.com', role: 'client' },
            { name: 'John', email: 'john@test.com', role: 'co_client' },
        ],
        completionPolicy: policy,
    });
    const signers = await db.select().from(schema.agreementSigners)
        .where(eq(schema.agreementSigners.requestId, r.requestId))
        .orderBy(asc(schema.agreementSigners.createdAt)).all();
    return { requestId: r.requestId, signers };
}

export const SIG = 'data:image/png;base64,aGVsbG8=';

export function postSign(body: Record<string, unknown>) {
    return {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    } as RequestInit;
}
