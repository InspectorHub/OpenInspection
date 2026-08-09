import { vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq, asc } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { AgreementService } from '../../../server/services/agreement.service';
import { InspectionService } from '../../../server/services/inspection.service';
import { PeopleService } from '../../../server/services/people.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { ROLE } from '../../../server/lib/auth/roles';
import { asD1Db, asD1DrizzleReturn, asScopedDbSource, type TestDb } from './test-db';

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const INSP_ID = '00000000-0000-0000-0000-000000000010';
export const AGR_ID = '00000000-0000-0000-0000-000000000020';
export const JWT_SECRET = 'test-secret';
export const CLIENT_CONTACT_ID = '00000000-0000-0000-0000-0000000000c1';

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
    emailAgreementRequest?: ReturnType<typeof vi.fn>;
    workflowCreate?: ReturnType<typeof vi.fn>;
}

type SignWorkflow = NonNullable<HonoConfig['Bindings']['SIGN_COMPLETION_WORKFLOW']>;

/**
 * A `Workflow` binding whose only exercised method is `create` — the one
 * `server/lib/sign-effects.ts` calls, and whose RESULT that caller discards.
 * All three members are present so the shape is complete; the cast covers only
 * the return types, because `vi.fn()`'s default `Mock<Procedure |
 * Constructable>` is both callable and constructable and therefore matches no
 * concrete method signature. Narrowing the mocks instead (`vi.fn<SignWorkflow
 * ['create']>()`) would force every spec to resolve a real `WorkflowInstance`
 * that nothing reads.
 */
function workflowStub(create: ReturnType<typeof vi.fn>): SignWorkflow {
    return { create, get: vi.fn(), createBatch: vi.fn() } as unknown as SignWorkflow;
}

export function buildApp(db: TestDb, stubs: Stubs = {}) {
    const auditAppend = stubs.auditAppend ?? vi.fn().mockResolvedValue({ id: 'a', hash: 'h' });
    const automationTrigger = stubs.automationTrigger ?? vi.fn().mockResolvedValue(undefined);
    const notificationCreate = stubs.notificationCreate ?? vi.fn().mockResolvedValue(undefined);
    const emailConfirm = stubs.emailConfirm ?? vi.fn().mockResolvedValue(undefined);
    const emailAgreementRequest = stubs.emailAgreementRequest ?? vi.fn().mockResolvedValue(undefined);
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
        c.set('userRole', ROLE.OWNER);
        c.set('services', {
            agreement,
            inspection: new InspectionService({} as D1Database, undefined, new ScopedDB(asScopedDbSource(db), TENANT_ID)),
            people: new PeopleService({ DB: {} as D1Database }),
            auditLog: { append: auditAppend },
            automation: { trigger: automationTrigger },
            notification: { createForAllAdmins: notificationCreate },
            email: {
                sendAgreementSignedConfirmation: emailConfirm,
                sendAgreementRequest: emailAgreementRequest,
            },
        } as unknown as HonoConfig['Variables']['services']);
        // `SIGN_COMPLETION_WORKFLOW` is a declared optional binding on AppEnv
        // (server/types/hono.ts), so this is a plain assignment — only the
        // stub itself needs shaping, and `Workflow` is a 3-method interface.
        c.env.SIGN_COMPLETION_WORKFLOW = workflowStub(workflowCreate);
        await next();
    });
    app.route('/', inspectionsRoutes);
    // `drizzle-orm/d1` is vi.mock'd by the specs that use this helper; hand the
    // mock the SQLite database every service under test will actually query.
    vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(db));

    return { app, auditAppend, automationTrigger, notificationCreate, emailConfirm, emailAgreementRequest, workflowCreate };
}

export async function seedBase(db: TestDb, opts: { withTemplate?: boolean } = {}) {
    await db.insert(schema.tenants).values({
        id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    });
    // Task 9b (people-role-profiles) — AgreementService.findOrCreate's default
    // signer resolves via the inspection_people primary-client join
    // (PeopleService.getPrimaryClient). The clientName/clientEmail columns this
    // row used to carry were DROPPED from `inspections` (schema/inspection/
    // core.ts); the contact + primary-client rows below are now the only
    // source of the "Jane" / "jane@test.com" default signer.
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
        price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
    });
    await seedRoleProfiles(asD1Db(db), TENANT_ID, new Date(1));
    await db.insert(schema.contacts).values({
        id: CLIENT_CONTACT_ID, tenantId: TENANT_ID, type: 'client', name: 'Jane', email: 'jane@test.com', createdAt: new Date(),
    });
    await db.insert(schema.inspectionPeople).values({
        id: `ip_${INSP_ID}_client`, tenantId: TENANT_ID, inspectionId: INSP_ID,
        contactId: CLIENT_CONTACT_ID, roleProfileId: `crp_${TENANT_ID}_client`, createdAt: new Date(),
    });
    if (opts.withTemplate ?? true) {
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'ORIGINAL agreement text', version: 1, createdAt: new Date(),
        });
    }
}

/** Seed a 2-signer envelope directly via the service. */
export async function createTwoSignerEnvelope(db: TestDb, policy: 'all' | 'one' = 'all') {
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

export function postAgreementRequest(body: Record<string, unknown> = {}) {
    return {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    } as RequestInit;
}
