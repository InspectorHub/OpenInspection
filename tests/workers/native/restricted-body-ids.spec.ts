/**
 * An id a restricted person supplies in a REQUEST BODY must be indistinguishable from one that does not exist,
 * and must never be attachable to something they can see. (Path ids are handled by the path guard.)
 *
 * Every refusal compares the answer for a hidden id with the answer for a nonexistent one after the id is
 * normalised, and is paired with a control: the visible id still works, and an unrestricted caller keeps the answer
 * it had before.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../../server/index';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { applyMigrations } from '../migration-replay';

const migrationSql = import.meta.glob('../../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface TestBindings { DB: D1Database }
const b = testEnv as unknown as TestBindings;

const TENANT = 'body-ids-tenant';
const TEMPLATE = 'body-ids-template';
const PROFILE = 'body-ids-profile';
const PROFILE_OTHER = 'body-ids-profile-other';

interface Member { id: string; token: string }
const grants = new Map<string, NativeProps>();
let seq = 0;
const fresh = (prefix: string): string => `${prefix}-${++seq}-${crypto.randomUUID().slice(0, 6)}`;

const provider = {
    unwrapToken: async (t: string) => {
        const props = grants.get(t);
        return props ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props } } : null;
    },
};

async function addMember(role: 'owner' | 'inspector', overrides: Record<string, boolean> | null = null): Promise<Member> {
    const id = fresh(`user-${role}`);
    await b.DB.prepare('INSERT INTO users (id, tenant_id, email, password_hash, name, role, permission_overrides, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, TENANT, `${id}@example.test`, 'x', id, role, overrides ? JSON.stringify(overrides) : null, Date.now()).run();
    const token = `u:g:${id}`;
    grants.set(token, { kind: 'native', userId: id, tenantId: TENANT, role, lastUsedAt: 0, grantedAt: 0 });
    return { id, token };
}

const pending: Promise<unknown>[] = [];
const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

async function call(path: string, token: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
    const headers = new Headers({ authorization: `Bearer ${token}` });
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    const env = { ...testEnv, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider };
    const res = await app.fetch(new Request(`http://x${path}`, {
        method: init.method ?? 'GET', headers, ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    }), env as never, ctx);
    await Promise.all(pending.splice(0));
    return res;
}

async function createInspection(by: Member): Promise<string> {
    const id = fresh('insp');
    const res = await call('/api/inspections', by.token, {
        method: 'POST',
        json: { id, propertyAddress: `${id} Road`, templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z' },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return id;
}

async function addContact(createdBy: string | null, onInspection: string | null): Promise<string> {
    const id = fresh('contact');
    await b.DB.prepare('INSERT INTO contacts (id, tenant_id, type, name, email, phone, notes, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, TENANT, 'client', `Name ${id}`, `${id}@example.test`, '555-0100', 'private note', createdBy, Date.now()).run();
    if (onInspection) {
        await b.DB.prepare('INSERT INTO inspection_people (id, tenant_id, inspection_id, contact_id, role_profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(fresh('ip'), TENANT, onInspection, id, PROFILE, Date.now()).run();
    }
    return id;
}

/** Status and body, with the id the caller supplied replaced so two answers can be compared. */
async function shape(res: Response, id: string): Promise<{ status: number; body: string }> {
    return { status: res.status, body: (await res.text()).split(id).join('<ID>') };
}

describe('ids in a request body, for a restricted inspector', () => {
    let owner: Member;
    let restricted: Member;
    let peer: Member;
    let open: Member;
    let mine: string;
    let theirs: string;
    let visibleContact: string;
    let hiddenContact: string;

    beforeAll(async () => {
        await applyMigrations(b.DB, migrationSql);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);');
        const now = Date.now();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(TENANT, 'body-ids-tenant', now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO templates (id, tenant_id, name, version, schema, created_at) VALUES (?, ?, ?, 1, ?, ?)')
            .bind(TEMPLATE, TENANT, 'Standard', JSON.stringify({ sections: [] }), now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO contact_role_profiles (id, tenant_id, key, label, kind, is_system, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?, ?)')
            .bind(PROFILE, TENANT, 'client', 'Client', 'client', now, now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO contact_role_profiles (id, tenant_id, key, label, kind, is_system, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?, ?)')
            .bind(PROFILE_OTHER, TENANT, 'other', 'Other', 'other', now, now).run();
        await b.DB.prepare('INSERT OR IGNORE INTO contact_role_profiles (id, tenant_id, key, label, kind, is_system, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?, ?)')
            .bind('body-ids-profile-agent', TENANT, 'buyer_agent', 'Buyer agent', 'agent', now, now).run();
        owner = await addMember('owner');
        restricted = await addMember('inspector', { viewAllInspections: false });
        peer = await addMember('inspector', { viewAllInspections: false });
        open = await addMember('inspector');
        mine = await createInspection(restricted);
        theirs = await createInspection(peer);
        visibleContact = await addContact(null, mine);
        hiddenContact = await addContact(owner.id, theirs);
    });

    describe('POST /api/invoices/request-payment', () => {
        const ask = (m: Member, inspectionId: string) => call('/api/invoices/request-payment', m.token, { method: 'POST', json: { inspectionId } });
        it('a hidden inspection answers like one that does not exist', async () => {
            const ghost = fresh('insp-ghost');
            const hidden = await shape(await ask(restricted, theirs), theirs);
            const absent = await shape(await ask(restricted, ghost), ghost);
            expect(absent.status).toBe(404);
            expect(hidden).toEqual(absent);
        });
        it('controls: the own inspection is not refused for scope, and others keep their answers', async () => {
            const own = await ask(restricted, mine);
            expect([403, 404]).not.toContain(own.status);
            const ghost = fresh('insp-ghost');
            expect((await ask(owner, ghost)).status).toBe(404);
            // Sees everything but does not work this inspection and cannot schedule others: the specific 403 stays.
            const notOnJob = await ask(open, theirs);
            expect(notOnJob.status).toBe(403);
            expect(await notOnJob.text()).toContain('You are not on this inspection');
        });
    });

    describe('POST /api/inspections/:id/people', () => {
        const add = (m: Member, contactId: string) => call(`/api/inspections/${mine}/people`, m.token, { method: 'POST', json: { contactId, roleProfileId: PROFILE_OTHER } });
        it('a hidden contact answers like one that does not exist, and is not attached', async () => {
            const ghost = fresh('contact-ghost');
            const hidden = await shape(await add(restricted, hiddenContact), hiddenContact);
            const absent = await shape(await add(restricted, ghost), ghost);
            expect(absent.status).toBe(404);
            expect(hidden).toEqual(absent);
            const attached = await b.DB.prepare('SELECT COUNT(*) AS n FROM inspection_people WHERE inspection_id = ? AND contact_id = ?').bind(mine, hiddenContact).first<{ n: number }>();
            expect(attached?.n).toBe(0);
            expect((await call(`/api/contacts/${hiddenContact}`, restricted.token)).status).toBe(404);
        });
        it('controls: a visible contact is added, and an owner can add any contact', async () => {
            const extra = await addContact(restricted.id, null);
            const ok = await add(restricted, extra);
            expect(ok.status, await ok.clone().text()).toBe(201);
            const elsewhere = await addContact(owner.id, theirs);
            const byOwner = await call(`/api/inspections/${mine}/people`, owner.token, { method: 'POST', json: { contactId: elsewhere, roleProfileId: PROFILE_OTHER } });
            expect(byOwner.status, await byOwner.clone().text()).toBe(201);
        });
    });

    describe('PATCH /api/inspections/:id referredByContactId', () => {
        const patch = (m: Member, id: string, referredByContactId: string) => call(`/api/inspections/${id}`, m.token, { method: 'PATCH', json: { referredByContactId } });
        it('a hidden contact answers like one that does not exist, and is not stored', async () => {
            const target = await createInspection(restricted);
            const hiddenHere = await addContact(owner.id, theirs);
            const ghost = fresh('contact-ghost');
            const hidden = await shape(await patch(restricted, target, hiddenHere), hiddenHere);
            const absent = await shape(await patch(restricted, target, ghost), ghost);
            expect(absent.status).toBe(400);
            expect(hidden).toEqual(absent);
            const row = await b.DB.prepare('SELECT referred_by_contact_id AS r FROM inspections WHERE id = ?').bind(target).first<{ r: string | null }>();
            expect(row?.r).toBeNull();
        });
        it('controls: a visible contact is stored, and an owner may name any contact', async () => {
            const target = await createInspection(restricted);
            const ok = await patch(restricted, target, visibleContact);
            expect(ok.status, await ok.clone().text()).toBe(200);
            const byOwner = await patch(owner, target, await addContact(owner.id, theirs));
            expect(byOwner.status, await byOwner.clone().text()).toBe(200);
        });
    });

    describe('POST /api/inspections naming an agent contact', () => {
        const create = (m: Member, id: string, agentContactId: string) => call('/api/inspections', m.token, {
            method: 'POST', json: { id, propertyAddress: `${id} Road`, templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z', agentContactId },
        });
        it('a hidden contact answers like one that does not exist, and is not linked', async () => {
            const hiddenAgent = await addContact(owner.id, theirs);
            const ghost = fresh('contact-ghost');
            const idA = fresh('insp-new');
            const idB = fresh('insp-new');
            const hidden = await shape(await create(restricted, idA, hiddenAgent), hiddenAgent);
            const absent = await shape(await create(restricted, idB, ghost), ghost);
            expect(hidden.status).toBe(404);
            expect(hidden).toEqual(absent);
            const linked = await b.DB.prepare('SELECT COUNT(*) AS n FROM inspection_people WHERE contact_id = ? AND inspection_id = ?').bind(hiddenAgent, idA).first<{ n: number }>();
            expect(linked?.n).toBe(0);
        });
        it('controls: a visible contact is linked, and an owner may name any contact', async () => {
            const ok = await create(restricted, fresh('insp-new'), visibleContact);
            expect(ok.status, await ok.clone().text()).toBe(201);
            const byOwner = await create(owner, fresh('insp-new'), await addContact(owner.id, theirs));
            expect(byOwner.status, await byOwner.clone().text()).toBe(201);
        });
    });

    describe('POST /api/inspections naming a person by email', () => {
        const emailOf = (contactId: string) => `${contactId}@example.test`;
        type Field = 'client' | 'newAgent' | 'flat';
        const create = (m: Member, id: string, field: Field, email: string) => call('/api/inspections', m.token, {
            method: 'POST',
            json: {
                id, propertyAddress: `${id} Road`, templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z',
                ...(field === 'client' ? { client: { name: 'Pat Example', email } } : {}),
                ...(field === 'newAgent' ? { newAgent: { name: 'Agent Example', email } } : {}),
                ...(field === 'flat' ? { clientName: 'Pat Example', clientEmail: email } : {}),
            },
        });
        const linked = async (inspectionId: string, contactId: string) => (await b.DB.prepare('SELECT COUNT(*) AS n FROM inspection_people WHERE inspection_id = ? AND contact_id = ?').bind(inspectionId, contactId).first<{ n: number }>())?.n ?? 0;
        const rows = async (inspectionId: string) => (await b.DB.prepare('SELECT COUNT(*) AS n FROM inspections WHERE id = ?').bind(inspectionId).first<{ n: number }>())?.n ?? 0;

        for (const field of ['client', 'newAgent', 'flat'] as const) {
            it(`${field}: an address that belongs to a hidden contact is refused whole, like a contact create`, async () => {
                const hiddenOne = await addContact(owner.id, theirs);
                const id = fresh('insp-new');
                const res = await create(restricted, id, field, emailOf(hiddenOne));
                const text = await res.text();
                expect(res.status, text).toBe(409);
                expect(text).toContain('A contact with this email already exists');
                expect(text).not.toContain(hiddenOne);
                expect(await rows(id)).toBe(0);
                expect(await linked(id, hiddenOne)).toBe(0);
                expect((await call(`/api/contacts/${hiddenOne}`, restricted.token)).status).toBe(404);
                expect((await call(`/api/messages/threads/${hiddenOne}`, restricted.token)).status).toBe(404);
            });
        }
        it('a hidden address in the agent field refuses the whole create even when the client is new', async () => {
            const hiddenOne = await addContact(owner.id, theirs);
            const id = fresh('insp-new');
            const res = await call('/api/inspections', restricted.token, {
                method: 'POST',
                json: { id, propertyAddress: `${id} Road`, templateId: TEMPLATE, date: '2026-10-01T10:00:00.000Z',
                    client: { name: 'Fresh Client', email: `${id}-fresh@example.test` }, newAgent: { name: 'A', email: emailOf(hiddenOne) } },
            });
            expect(res.status).toBe(409);
            expect(await rows(id)).toBe(0);
            const orphan = await b.DB.prepare('SELECT COUNT(*) AS n FROM contacts WHERE email = ?').bind(`${id}-fresh@example.test`).first<{ n: number }>();
            expect(orphan?.n).toBe(0);
        });
        it('controls: a new address creates a visible contact, and a visible contact is reused and linked', async () => {
            for (const field of ['client', 'newAgent', 'flat'] as const) {
                const id = fresh('insp-new');
                const email = `${id}-new@example.test`;
                const ok = await create(restricted, id, field, email);
                expect(ok.status, await ok.clone().text()).toBe(201);
                const row = await b.DB.prepare('SELECT id FROM contacts WHERE email = ?').bind(email).first<{ id: string }>();
                expect(row, field).not.toBeNull();
                expect((await call(`/api/contacts/${row!.id}`, restricted.token)).status).toBe(200);
            }
            const id = fresh('insp-new');
            const reuse = await create(restricted, id, 'client', emailOf(visibleContact));
            expect(reuse.status, await reuse.clone().text()).toBe(201);
            expect(await linked(id, visibleContact)).toBe(1);
        });
        it('controls: an owner naming a hidden contact address reuses and links it', async () => {
            for (const field of ['client', 'newAgent', 'flat'] as const) {
                const hiddenOne = await addContact(peer.id, theirs);
                const id = fresh('insp-new');
                const ok = await create(owner, id, field, emailOf(hiddenOne));
                expect(ok.status, `${field} ${await ok.clone().text()}`).toBe(201);
                expect(await linked(id, hiddenOne), field).toBe(1);
            }
        });
    });

    describe('POST /api/messages/threads/:contactId with an inspectionId in the body', () => {
        const send = (m: Member, inspectionId: string) => call(`/api/messages/threads/${visibleContact}`, m.token, { method: 'POST', json: { body: 'hello', inspectionId } });
        it('a hidden inspection answers like one that does not exist', async () => {
            const ghost = fresh('insp-ghost');
            const hidden = await shape(await send(restricted, theirs), theirs);
            const absent = await shape(await send(restricted, ghost), ghost);
            expect(absent.status).toBe(404);
            expect(hidden).toEqual(absent);
        });
        it('controls: the own inspection takes the message, and an owner on a missing id keeps its answer', async () => {
            const ok = await send(restricted, mine);
            expect(ok.status, await ok.clone().text()).toBe(201);
            expect([403, 404]).toContain((await send(owner, fresh('insp-ghost'))).status);
        });
    });
    describe('GET /api/agents/links and POST /api/agents/:linkId/revoke', () => {
        const linkedAgent = async (onInspection: string | null, createdBy: string | null): Promise<string> => {
            const id = await addContact(createdBy, onInspection);
            await b.DB.prepare('UPDATE contacts SET type = ?, agent_user_id = ?, agent_linked_at = ? WHERE id = ?').bind('agent', fresh('agent-user'), Date.now(), id).run();
            return id;
        };
        const links = async (m: Member): Promise<string[]> => {
            const res = await call('/api/agents/links', m.token);
            expect(res.status, await res.clone().text()).toBe(200);
            return ((await res.json()) as { data: { links: Array<{ id: string }> } }).data.links.map((l) => l.id);
        };
        const revoke = (m: Member, id: string) => call(`/api/agents/${id}/revoke`, m.token, { method: 'POST' });
        const revokedAt = async (id: string) => (await b.DB.prepare('SELECT agent_revoked_at AS r FROM contacts WHERE id = ?').bind(id).first<{ r: number | null }>())?.r ?? null;

        it('the list holds only the partner agents the caller can see, and the owner sees all (control)', async () => {
            const visibleAgent = await linkedAgent(mine, null);
            const hiddenAgent = await linkedAgent(theirs, owner.id);
            const seen = await links(restricted);
            expect(seen).toContain(visibleAgent);
            expect(seen).not.toContain(hiddenAgent);
            const all = await links(owner);
            expect(all).toEqual(expect.arrayContaining([visibleAgent, hiddenAgent]));
        });
        it('revoking a hidden link answers like a contact that does not exist, and revokes nothing', async () => {
            const hiddenAgent = await linkedAgent(theirs, owner.id);
            const ghost = fresh('link-ghost');
            const hidden = await shape(await revoke(restricted, hiddenAgent), hiddenAgent);
            const absent = await shape(await revoke(restricted, ghost), ghost);
            expect(absent.status).toBe(404);
            expect(hidden).toEqual(absent);
            expect(await revokedAt(hiddenAgent)).toBeNull();
        });
        it('controls: a visible link is revoked by the restricted caller, and an owner may revoke any', async () => {
            const visibleAgent = await linkedAgent(mine, null);
            expect((await revoke(restricted, visibleAgent)).status).toBe(200);
            expect(await revokedAt(visibleAgent)).not.toBeNull();
            const elsewhere = await linkedAgent(theirs, owner.id);
            expect((await revoke(owner, elsewhere)).status).toBe(200);
            expect(await revokedAt(elsewhere)).not.toBeNull();
        });
    });
});
