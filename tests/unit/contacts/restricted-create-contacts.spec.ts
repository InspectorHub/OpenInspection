/**
 * Creating an inspection as a person who sees only their assignments, through the real app (POST /api/inspections):
 *
 *  - a client named with no e-mail address is reused only when the caller created that very contact and it carries no
 *    address, so a notice can never be redirected to someone else's address by a shared name (B2);
 *  - a refused create leaves nothing behind: no new contact, no change to a matched one (B3);
 *  - a restricted caller links a matched contact and changes nothing on it (B4).
 *
 * Every refusal is paired with a control that goes through.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, OWNER_ID, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const TEMPLATE = 'tpl-own';
const VISIBLE_INSPECTION = 'insp-visible';
const OTHER_INSPECTION = 'insp-other';

describe('restricted creator and contacts', () => {
    let h: Harness | undefined;
    afterEach(() => { h?.close(); h = undefined; });

    async function seed(): Promise<Harness> {
        const created = await createHarness('standalone');
        const now = new Date();
        const clientRole = (await created.db.select().from(schema.contactRoleProfiles)
            .where(eq(schema.contactRoleProfiles.key, 'client')).get())!;
        await created.db.insert(schema.templates).values({ id: TEMPLATE, tenantId: TENANT_ID, name: 'Own', schema: { sections: [] }, version: 1, createdAt: now } as never);
        await created.db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false } as never }).where(eq(schema.users.id, INSPECTOR_ID));
        const base = { tenantId: TENANT_ID, date: '2026-06-01', status: 'scheduled', paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: now };
        await created.db.insert(schema.inspections).values([
            { ...base, id: VISIBLE_INSPECTION, propertyAddress: '1 Mine Street', inspectorId: INSPECTOR_ID },
            { ...base, id: OTHER_INSPECTION, propertyAddress: '2 Theirs Street', inspectorId: OWNER_ID },
        ] as never);
        await created.db.insert(schema.inspectionInspectors).values([
            { inspectionId: VISIBLE_INSPECTION, userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
            { inspectionId: OTHER_INSPECTION, userId: OWNER_ID, tenantId: TENANT_ID, role: 'lead', createdAt: now },
        ]);
        await created.db.insert(schema.contacts).values([
            // visible to the caller (on their inspection), carries an address: someone else's client
            { id: 'c-visible', tenantId: TENANT_ID, type: 'client', name: 'John Smith', email: 'john@visible.test', phone: null, locale: 'en', createdAt: now },
            // not visible: on a colleague's inspection
            { id: 'c-hidden', tenantId: TENANT_ID, type: 'client', name: 'Pat Hidden', email: 'pat@hidden.test', phone: '555-0100', createdAt: now },
        ] as never);
        for (const [id, inspectionId, contactId] of [['p1', VISIBLE_INSPECTION, 'c-visible'], ['p2', OTHER_INSPECTION, 'c-hidden']] as const) {
            await created.db.insert(schema.inspectionPeople).values({ id, tenantId: TENANT_ID, inspectionId, contactId, roleProfileId: clientRole.id, createdAt: now } as never);
        }
        return created;
    }

    async function post(who: 'inspector' | 'owner', body: Record<string, unknown>): Promise<{ status: number; id?: string; text: string }> {
        const keyring = await buildKeyring(h!.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const sub = who === 'owner' ? OWNER_ID : INSPECTOR_ID;
        const jwt = await signJwt({ sub, role: who, 'custom:userRole': who, 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600 }, keyring);
        const exec = makeExecutionContext({ label: 'restricted-create' });
        const res = await app.request('/api/inspections', {
            method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ templateId: TEMPLATE, ...body }),
        }, h!.env, exec.ctx);
        await exec.settle();
        const text = await res.text();
        const id = res.status === 201 ? (JSON.parse(text) as { data: { inspection: { id: string } } }).data.inspection.id : undefined;
        return { status: res.status, ...(id ? { id } : {}), text };
    }
    const create = (n: number, client: Record<string, unknown>, who: 'inspector' | 'owner' = 'inspector') =>
        post(who, { propertyAddress: `${n} New Road`, client });
    const clientOf = async (inspectionId: string) => (await h!.db.select().from(schema.inspectionPeople)
        .where(and(eq(schema.inspectionPeople.inspectionId, inspectionId), eq(schema.inspectionPeople.tenantId, TENANT_ID))).all())[0]?.contactId;
    const contact = (id: string) => h!.db.select().from(schema.contacts).where(eq(schema.contacts.id, id)).get();
    const contactCount = async () => (await h!.db.select().from(schema.contacts).all()).length;

    describe('name-only client (B2)', () => {
        it('a visible same-name contact that has an address is NOT reused: a new contact is made', async () => {
            h = await seed();
            const res = await create(10, { name: 'John Smith' });
            expect(res.status, res.text).toBe(201);
            const linked = await clientOf(res.id!);
            expect(linked).toBeTruthy();
            expect(linked).not.toBe('c-visible');
            expect(await contact(linked!)).toMatchObject({ name: 'John Smith', email: null, createdByUserId: INSPECTOR_ID });
            // the other person's address and phone are exactly as they were
            expect(await contact('c-visible')).toMatchObject({ email: 'john@visible.test', phone: null });
        });

        it('control: the callers own address-less contact of that name is reused the second time', async () => {
            h = await seed();
            const first = await create(11, { name: 'Jane Doe' });
            const second = await create(12, { name: 'Jane Doe' });
            expect(first.status, first.text).toBe(201);
            expect(second.status, second.text).toBe(201);
            expect(await clientOf(second.id!)).toBe(await clientOf(first.id!));
            expect((await h.db.select().from(schema.contacts).all()).filter((c) => c.name === 'Jane Doe')).toHaveLength(1);
        });

        it('a same-name contact only a colleague can see is not matched and a new one is made', async () => {
            h = await seed();
            const res = await create(13, { name: 'Pat Hidden' });
            expect(res.status, res.text).toBe(201);
            expect(await clientOf(res.id!)).not.toBe('c-hidden');
            expect(await contact('c-hidden')).toMatchObject({ email: 'pat@hidden.test', phone: '555-0100' });
        });

        it('a contact the caller made that later gained an address is no longer matched by name alone', async () => {
            h = await seed();
            const first = await create(14, { name: 'Sam Lee' });
            const madeId = (await clientOf(first.id!))!;
            await h.db.update(schema.contacts).set({ email: 'sam@later.test' }).where(eq(schema.contacts.id, madeId));
            const second = await create(15, { name: 'Sam Lee' });
            expect(await clientOf(second.id!)).not.toBe(madeId);
        });

        it('control: an unrestricted caller keeps getting a fresh row for a name-only client', async () => {
            h = await seed();
            const a = await create(16, { name: 'John Smith' }, 'owner');
            const b = await create(17, { name: 'John Smith' }, 'owner');
            expect(await clientOf(a.id!)).not.toBe(await clientOf(b.id!));
        });
    });

    describe('a refused create leaves nothing behind (B3)', () => {
        it('an unknown template adds no contact and fills nothing forward on a matched one', async () => {
            h = await seed();
            const before = await contactCount();
            const refused = await post('inspector', {
                templateId: 'tpl-nope', propertyAddress: '20 Refused Road',
                client: { name: 'Someone New', email: 'new@person.test' }, newAgent: { name: 'Agent New', email: 'agent@new.test' },
            });
            expect(refused.status).toBe(400);
            expect(await contactCount()).toBe(before);
            // the same on an unrestricted caller with a matched contact: its blank phone stays blank
            const refusedOwner = await post('owner', {
                templateId: 'tpl-nope', propertyAddress: '21 Refused Road',
                client: { name: 'John Smith', email: 'john@visible.test', phone: '555-7777' },
            });
            expect(refusedOwner.status).toBe(400);
            expect(await contact('c-visible')).toMatchObject({ phone: null });
            // control: the same bodies with a real template go through and do write
            const ok = await post('owner', { propertyAddress: '22 Fine Road', client: { name: 'John Smith', email: 'john@visible.test', phone: '555-7777' } });
            expect(ok.status, ok.text).toBe(201);
            expect(await contact('c-visible')).toMatchObject({ phone: '555-7777' });
            const okNew = await post('inspector', { propertyAddress: '23 Fine Road', client: { name: 'Someone New', email: 'new@person.test' } });
            expect(okNew.status, okNew.text).toBe(201);
            expect(await contactCount()).toBe(before + 1);
        });
    });

    describe('a restricted caller links a matched contact and changes nothing on it (B4)', () => {
        it('name, phone and locale on a visible contact matched by address are left as they were', async () => {
            h = await seed();
            const before = await contact('c-visible');
            const res = await create(30, { name: 'Johnny S.', email: 'JOHN@visible.test', phone: '555-8888' });
            expect(res.status, res.text).toBe(201);
            expect(await clientOf(res.id!)).toBe('c-visible');
            expect(await contact('c-visible')).toEqual(before);
        });

        it('control: an unrestricted caller still fills a blank phone forward on the same contact', async () => {
            h = await seed();
            const res = await create(31, { name: 'Johnny S.', email: 'john@visible.test', phone: '555-8888' }, 'owner');
            expect(res.status, res.text).toBe(201);
            expect(await contact('c-visible')).toMatchObject({ phone: '555-8888', name: 'John Smith' });
        });
    });
});

describe('a create refused for the plan cap leaves no contact behind (B3)', () => {
    let h: Harness | undefined;
    afterEach(() => { h?.close(); h = undefined; });

    it('a Free company at its cap gets 402 and no contact is written; below the cap the same body creates both', async () => {
        h = await createHarness('saas');
        const now = new Date();
        await h.db.insert(schema.templates).values({ id: TEMPLATE, tenantId: TENANT_ID, name: 'Own', schema: { sections: [] }, version: 1, createdAt: now } as never);
        const filler = (i: number) => ({ id: `fill-${i}`, tenantId: TENANT_ID, propertyAddress: `${i} Filler Way`, date: '2026-06-01', status: 'scheduled', paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: now });
        await h.db.insert(schema.inspections).values([1, 2, 3, 4].map(filler) as never);
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const iat = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({ sub: OWNER_ID, role: 'owner', 'custom:userRole': 'owner', 'custom:tenantId': TENANT_ID, iat, exp: iat + 3600 }, keyring);
        const send = async (n: number) => {
            const exec = makeExecutionContext({ label: 'cap' });
            const res = await app.request('/api/inspections', {
                method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
                body: JSON.stringify({ templateId: TEMPLATE, propertyAddress: `${n} Capped Road`, client: { name: `Client ${n}`, email: `c${n}@cap.test` } }),
            }, h!.env, exec.ctx);
            await exec.settle();
            return res.status;
        };
        const count = async () => (await h!.db.select().from(schema.contacts).all()).length;
        expect(await send(1)).toBe(201); // the fifth inspection fits
        expect(await count()).toBe(1);
        expect(await send(2)).toBe(402); // the sixth does not
        expect(await count()).toBe(1);
    });
});
