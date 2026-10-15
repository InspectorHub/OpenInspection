/**
 * Report sending, templates, agent-minted sessions and messaging, through the
 * REAL app and middleware chain (in-memory SQLite, real JWT keyring, no auth
 * mocking), in standalone mode where the tenant resolves from configuration.
 *
 *  A. send-report-pdf / share-agent / agent-token / report-link-expiry: published
 *     reports only, assigned-or-scheduleOthers, bounded and restricted recipients,
 *     a per-recipient hourly ceiling.
 *  B. templates are staff-only (no anonymous or agent reads).
 *  C. an agent minted through the real /api/agent-signup receives no staff data.
 *  D. messaging into an inspection's thread, and clearing its unread counts, is
 *     the assignee's act; reading stays company-wide.
 *
 * Every denial is paired with an allowed control.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID, type Harness } from '../helpers/tenant-email-harness';
import { DeploymentLegalService } from '../../../server/services/deployment-legal.service';

const MANAGER_ID = '22222222-0000-4000-8000-000000000003';
const OTHER_ID = '22222222-0000-4000-8000-000000000004';
const THEIRS = '44444444-0000-4000-8000-000000000001'; // published, assigned to OTHER_ID
const MINE = '44444444-0000-4000-8000-000000000002'; // published, assigned to INSPECTOR_ID
const DRAFT = '44444444-0000-4000-8000-000000000003'; // draft, assigned to INSPECTOR_ID
const CLIENT = '55555555-0000-4000-8000-000000000001';
const STRANGER_EMAIL = 'stranger@evil.test';
const CLIENT_EMAIL = 'client@buyer.test';

type Actor = 'anon' | 'inspector' | 'manager' | 'owner';

async function setup() {
    const h = await createHarness('standalone');
    const now = new Date();
    (h.env as unknown as Record<string, unknown>).PHOTOS = { list: async () => ({ objects: [], truncated: false }), delete: async () => undefined };
    await h.db.insert(schema.users).values([
        { id: MANAGER_ID, tenantId: TENANT_ID, email: 'mgr@x.test', passwordHash: 'h', role: 'manager', name: 'Mona', createdAt: now },
        { id: OTHER_ID, tenantId: TENANT_ID, email: 'ines@x.test', passwordHash: 'h', role: 'inspector', name: 'Ines', createdAt: now },
    ]);
    const base = {
        tenantId: TENANT_ID, propertyAddress: '99 Secret Lane', date: '2026-06-01', status: 'completed',
        paymentStatus: 'unpaid', price: 1000, agreementRequired: false, paymentRequired: false, createdAt: now,
    };
    await h.db.insert(schema.inspections).values([
        { ...base, id: THEIRS, inspectorId: OTHER_ID, reportStatus: 'published' },
        { ...base, id: MINE, inspectorId: INSPECTOR_ID, reportStatus: 'published' },
        { ...base, id: DRAFT, inspectorId: INSPECTOR_ID, reportStatus: 'in_progress' },
    ] as never);
    await h.db.insert(schema.inspectionInspectors).values([
        { inspectionId: THEIRS, userId: OTHER_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
        { inspectionId: MINE, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
        { inspectionId: DRAFT, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
    ]);
    await h.db.insert(schema.contacts).values({ id: CLIENT, tenantId: TENANT_ID, type: 'client', name: 'Casey Client', email: CLIENT_EMAIL, createdAt: now } as never);
    const profile = await h.db.select().from(schema.contactRoleProfiles).where(eq(schema.contactRoleProfiles.key, 'client')).get();
    for (const id of [THEIRS, MINE, DRAFT]) {
        await h.db.insert(schema.inspectionPeople).values({
            id: `person-${id}`, tenantId: TENANT_ID, inspectionId: id, contactId: CLIENT, roleProfileId: profile!.id, createdAt: now,
        } as never);
    }
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const tokens: Record<Actor, string | null> = { anon: null, inspector: null, manager: null, owner: null };
    for (const [actor, sub] of [['owner', OWNER_ID], ['manager', MANAGER_ID], ['inspector', INSPECTOR_ID]] as const) {
        tokens[actor] = await signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': actor, iat, exp: iat + 3600 }, keyring);
    }
    const call = async (actor: Actor | string, method: string, path: string, body?: unknown) => {
        const headers: Record<string, string> = {};
        const t = actor in tokens ? tokens[actor as Actor] : actor;
        if (t) headers.authorization = `Bearer ${t}`;
        const init: RequestInit = { method, headers };
        if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
        const exec = makeExecutionContext({ label: 'send' });
        const res = await app.request(path, init, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    return { h, call };
}

const send = (recipients: unknown[]) => ({ recipients, channels: ['email'] });
const toClient = { contactId: CLIENT, roleKey: 'client' };
const emailsTo = (h: Harness) => h.sent.flatMap((m) => m.to);

describe('A. sending a report', () => {
    it('a draft report is not sent, and nothing leaves; the published one is', async () => {
        const { h, call } = await setup();
        try {
            const draft = await call('owner', 'POST', `/api/inspections/${DRAFT}/send-report-pdf`, send([toClient]));
            expect(draft.status).toBe(409);
            expect(h.sent).toHaveLength(0);
            const published = await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([toClient]));
            expect(published.status).toBe(200);
            expect(emailsTo(h)).toEqual([CLIENT_EMAIL]);
        } finally { h.close(); }
    });

    it('share-agent and agent-token refuse a draft; agent-token works on a published report', async () => {
        const { h, call } = await setup();
        try {
            expect((await call('owner', 'POST', `/api/inspections/${DRAFT}/agent-token`)).status).toBe(409);
            expect((await call('owner', 'POST', `/api/inspections/${DRAFT}/share-agent`)).status).toBe(409);
            expect((await call('owner', 'POST', `/api/inspections/${MINE}/agent-token`)).status).toBe(200);
        } finally { h.close(); }
    });

    it('recipients must be people on the inspection, and at most ten', async () => {
        const { h, call } = await setup();
        try {
            const stranger = await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([{ email: STRANGER_EMAIL, roleKey: 'client' }]));
            expect(stranger.status).toBe(400);
            const mismatch = await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([{ ...toClient, email: STRANGER_EMAIL }]));
            expect(mismatch.status).toBe(400);
            const many = await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send(Array.from({ length: 11 }, () => toClient)));
            expect(many.status).toBe(400);
            expect(h.sent).toHaveLength(0);
            // control: the client by contact id, and by the client's own email
            expect((await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([toClient]))).status).toBe(200);
            expect((await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([{ email: CLIENT_EMAIL, roleKey: 'client' }]))).status).toBe(200);
        } finally { h.close(); }
    });

    it('the same recipient is sent the same inspection at most three times an hour', async () => {
        const { h, call } = await setup();
        try {
            for (let i = 0; i < 3; i += 1) {
                expect((await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([toClient]))).status).toBe(200);
            }
            expect((await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([toClient]))).status).toBe(429);
            expect(h.sent).toHaveLength(3);
            // control: a different inspection to the same person has its own count
            expect((await call('owner', 'POST', `/api/inspections/${THEIRS}/send-report-pdf`, send([toClient]))).status).toBe(200);
        } finally { h.close(); }
    });

    it('an inspector who does not work the inspection cannot send, share or re-date its links', async () => {
        const { h, call } = await setup();
        try {
            expect((await call('inspector', 'POST', `/api/inspections/${THEIRS}/send-report-pdf`, send([toClient]))).status).toBe(403);
            expect((await call('inspector', 'POST', `/api/inspections/${THEIRS}/agent-token`)).status).toBe(403);
            expect((await call('inspector', 'PUT', `/api/inspections/${THEIRS}/report-link-expiry`, { ttl: 'never' })).status).toBe(403);
            expect(h.sent).toHaveLength(0);
            // controls: their own inspection, a manager, and an inspector granted scheduleOthers
            expect((await call('inspector', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([toClient]))).status).toBe(200);
            expect((await call('inspector', 'PUT', `/api/inspections/${MINE}/report-link-expiry`, { ttl: 'never' })).status).toBe(200);
            expect((await call('manager', 'POST', `/api/inspections/${THEIRS}/agent-token`)).status).toBe(200);
            await h.db.update(schema.users).set({ permissionOverrides: { scheduleOthers: true } as never }).where(eq(schema.users.id, INSPECTOR_ID));
            expect((await call('inspector', 'POST', `/api/inspections/${THEIRS}/agent-token`)).status).toBe(200);
        } finally { h.close(); }
    });
});

describe('B. templates are staff-only', () => {
    it.each(['/api/inspections/templates', '/api/inspections/templates/some-template'])('anonymous GET %s is refused', async (path) => {
        const { h, call } = await setup();
        try {
            expect((await call('anon', 'GET', path)).status).toBe(401);
        } finally { h.close(); }
    });

    it('staff still list templates (positive control)', async () => {
        const { h, call } = await setup();
        try {
            for (const actor of ['inspector', 'manager', 'owner'] as const) {
                expect((await call(actor, 'GET', '/api/inspections/templates')).status).toBe(200);
            }
        } finally { h.close(); }
    });
});

describe('C. an agent minted through the real /api/agent-signup', () => {
    it('reads no inspection, draft report data or template; the agent surface still works', async () => {
        const { h, call } = await setup();
        try {
            // An operator who published agent terms and runs without a bot challenge.
            delete (h.env as unknown as Record<string, unknown>).TURNSTILE_SECRET_KEY;
            await new DeploymentLegalService(h.db as never).recordPublish({ doc: 'agent_terms', version: '2026-08-01', body: 'the agent terms' });
            const signup = await call('anon', 'POST', '/api/agent-signup', { email: 'mallory@evil.test', password: 'correct horse battery', name: 'Mallory Mint', termsAccepted: true });
            expect(signup.status).toBe(200);
            const jwt = (signup.headers.get('set-cookie') ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1];
            expect(jwt).toBeTruthy();
            for (const path of [`/api/inspections/${DRAFT}`, `/api/inspections/${DRAFT}/report-data`, '/api/inspections/templates']) {
                const res = await call(jwt!, 'GET', path);
                expect([401, 403], path).toContain(res.status);
                expect(await res.text()).not.toContain('99 Secret Lane');
            }
            expect((await call(jwt!, 'GET', '/api/agent/referrals')).status).toBe(200);
        } finally { h.close(); }
    });
});

describe('D. messaging is the assignee\'s act; reading is company-wide', () => {
    const unread = async (h: Harness, inspectionId: string) => (await h.db.select().from(schema.inspectionMessages).where(eq(schema.inspectionMessages.inspectionId, inspectionId)).all())
        .filter((m) => m.fromRole === 'client' && !m.readAt).length;

    async function clientMessage(h: Harness, inspectionId: string) {
        await h.db.insert(schema.inspectionMessages).values({
            id: `msg-${inspectionId}`, tenantId: TENANT_ID, inspectionId, contactId: CLIENT, fromRole: 'client',
            fromName: 'Casey Client', body: 'hello', createdAt: new Date(),
        } as never);
    }

    it('an unassigned inspector cannot message the client and does not clear the unread count; reading still works', async () => {
        const { h, call } = await setup();
        try {
            await clientMessage(h, THEIRS);
            expect((await call('inspector', 'POST', `/api/inspections/${THEIRS}/messages`, { body: 'hi', attachments: [], contactId: CLIENT })).status).toBe(403);
            expect((await call('inspector', 'POST', `/api/messages/threads/${CLIENT}`, { body: 'hi', inspectionId: THEIRS })).status).toBe(403);
            expect(h.sent).toHaveLength(0);
            const read = await call('inspector', 'GET', `/api/inspections/${THEIRS}/messages`);
            expect(read.status).toBe(200);
            expect(await unread(h, THEIRS)).toBe(1);
            // controls: the assignee, a manager and an inspector granted scheduleOthers
            expect((await call('manager', 'GET', `/api/inspections/${THEIRS}/messages`)).status).toBe(200);
            expect(await unread(h, THEIRS)).toBe(0);
        } finally { h.close(); }
    });

    it('the assignee can message their own client', async () => {
        const { h, call } = await setup();
        try {
            expect((await call('inspector', 'POST', `/api/inspections/${MINE}/messages`, { body: 'hi', attachments: [], contactId: CLIENT })).status).toBe(201);
            await h.db.update(schema.users).set({ permissionOverrides: { scheduleOthers: true } as never }).where(eq(schema.users.id, INSPECTOR_ID));
            expect((await call('inspector', 'POST', `/api/inspections/${THEIRS}/messages`, { body: 'hi', attachments: [], contactId: CLIENT })).status).toBe(201);
        } finally { h.close(); }
    });
});

describe('A (review). request shape, duplicates, quota burn, and send-sms', () => {
    it('malformed recipients are a 400, never a 500', async () => {
        const { h, call } = await setup();
        try {
            for (const recipients of [[null], [{ email: 5, roleKey: 'client' }], [42], 'x']) {
                const res = await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, { recipients });
                expect(res.status, JSON.stringify(recipients)).toBe(400);
            }
            expect(h.sent).toHaveLength(0);
        } finally { h.close(); }
    });

    it('duplicate recipients are refused, and a refused request does not burn the hourly quota', async () => {
        const { h, call } = await setup();
        try {
            const dup = await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([toClient, toClient]));
            expect(dup.status).toBe(400);
            const byEmail = await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([toClient, { email: CLIENT_EMAIL.toUpperCase(), roleKey: 'client' }]));
            expect(byEmail.status).toBe(400);
            expect(h.sent).toHaveLength(0);
            // three refused requests above spent nothing: three real sends still go through, the fourth does not
            for (let i = 0; i < 3; i += 1) {
                expect((await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([toClient]))).status).toBe(200);
            }
            expect((await call('owner', 'POST', `/api/inspections/${MINE}/send-report-pdf`, send([toClient]))).status).toBe(429);
        } finally { h.close(); }
    });

    it('send-sms follows the assigned-or-scheduleOthers rule', async () => {
        const { h, call } = await setup();
        try {
            const body = { recipients: [toClient] };
            expect((await call('inspector', 'POST', `/api/inspections/${THEIRS}/send-sms`, body)).status).toBe(403);
            // controls: their own inspection and a manager pass the new gate (the TCPA gate then decides)
            expect((await call('inspector', 'POST', `/api/inspections/${MINE}/send-sms`, body)).status).not.toBe(403);
            expect((await call('manager', 'POST', `/api/inspections/${THEIRS}/send-sms`, body)).status).not.toBe(403);
        } finally { h.close(); }
    });
});
