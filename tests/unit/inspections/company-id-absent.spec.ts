/**
 * A response to a signed-in caller of a company does not restate the company: the caller knows it from its session. Each route
 * below is called through the real application and the whole body is searched for the company id, raw and percent-encoded. Every
 * case is paired with a control that the stored row does hold the id, so its absence is the response and not the fixture.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { InspectionService } from '../../../server/services/inspection.service';
import { PeopleService } from '../../../server/services/people.service';
import { createHarness, INSPECTOR_ID, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const TEMPLATE_ID = 'tpl-company-id';
const SOURCE_ID = '44444444-0000-4000-8000-000000000011';
const NEW_ID = '33333333-0000-4000-8000-000000000011';
const AGENT_CONTACT = 'agent-contact-1';
const ITEM_ID = 'item-1';
const BOOKING = {
    id: NEW_ID, propertyAddress: '12 Booking Lane, Anytown', templateId: TEMPLATE_ID, date: '2026-06-01T10:00:00.000Z', price: 45000,
    client: { name: 'Pat Buyer', email: 'pat@example.com' },
};

describe('responses to a signed-in caller do not carry the company id', () => {
    let h: Harness;

    beforeEach(async () => {
        h = await createHarness('standalone');
        await h.db.insert(schema.templates).values({
            id: TEMPLATE_ID, tenantId: TENANT_ID, name: 'Standard', schema: { sections: [] }, version: 1, createdAt: new Date(),
        } as typeof schema.templates.$inferInsert);
        await h.db.insert(schema.inspections).values({
            id: SOURCE_ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '7 Source Road', date: new Date().toISOString().slice(0, 10),
            templateId: TEMPLATE_ID, status: 'confirmed', reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 52000, createdAt: new Date(),
            templateSnapshot: JSON.stringify({ sections: [] }) as never,
        });
    });
    afterEach(() => { vi.restoreAllMocks(); return h.close(); });

    async function call(method: string, path: string, body?: unknown, role = 'owner', sub = OWNER_ID): Promise<Response> {
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({ sub, role, 'custom:userRole': role, 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600 }, keyring);
        const exec = makeExecutionContext({ label: 'company-id-absent' });
        const res = await app.request(path, {
            method,
            headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }, h.env, exec.ctx);
        await exec.settle();
        return res;
    }

    /** Status in the expected set, and the whole body free of the company id in both spellings. */
    async function expectBare(res: Response, ok: number[] = [200, 201]): Promise<string> {
        const text = await res.text();
        expect(ok, text.slice(0, 300)).toContain(res.status);
        const at = text.indexOf(TENANT_ID);
        expect(at < 0 ? 'absent' : text.slice(Math.max(0, at - 80), at + 60)).toBe('absent');
        expect(encodeURIComponent(text)).not.toContain(TENANT_ID);
        return text;
    }

    const heldBy = async (table: 'inspections' | 'tags' | 'defectCategories' | 'contacts' | 'invoices' | 'inspectionRequests', id: string) => {
        const t = schema[table];
        const rows = await h.db.select().from(t).where(eq(t.id, id)).all();
        return rows[0]?.tenantId;
    };

    it('create, and a replay of it, answer the inspection without the company id', async () => {
        const created = await call('POST', '/api/inspections', BOOKING);
        await expectBare(created, [201]);
        expect(await heldBy('inspections', NEW_ID)).toBe(TENANT_ID);
        const replay = await call('POST', '/api/inspections', BOOKING);
        await expectBare(replay, [200]);
    });

    it('the replay answered after a concurrent insert wins is bare too', async () => {
        const existing = (await h.db.select().from(schema.inspections).where(eq(schema.inspections.id, SOURCE_ID)).get())!;
        expect(existing.tenantId).toBe(TENANT_ID);
        vi.spyOn(InspectionService.prototype, 'createInspectionOnce').mockResolvedValue({ inspection: existing, created: false } as never);
        await expectBare(await call('POST', '/api/inspections', { ...BOOKING, id: SOURCE_ID }), [200]);
    });

    it('read, clone and the report payload answer the inspection without the company id', async () => {
        await expectBare(await call('GET', `/api/inspections/${SOURCE_ID}`));
        await expectBare(await call('GET', `/api/inspections/${SOURCE_ID}/report-data`));
        const cloned = await call('POST', `/api/inspections/${SOURCE_ID}/clone`);
        const text = await expectBare(cloned, [201]);
        const id = (JSON.parse(text) as { data: { inspection: { id: string } } }).data.inspection.id;
        expect(await heldBy('inspections', id)).toBe(TENANT_ID);
    });

    it('tags: create, replace, list and the item tags answer without the company id', async () => {
        const created = await call('POST', '/api/tags', { name: 'Urgent' });
        const tag = (JSON.parse(await expectBare(created)) as { data: { id: string } }).data;
        expect(await heldBy('tags', tag.id)).toBe(TENANT_ID);
        await expectBare(await call('PUT', `/api/tags/${tag.id}`, { name: 'Urgent now' }));
        await expectBare(await call('GET', '/api/tags'));
        await expectBare(await call('POST', `/api/inspections/${SOURCE_ID}/items/${ITEM_ID}/tags`, { tagId: tag.id }));
        const items = await call('GET', `/api/inspections/${SOURCE_ID}/items/${ITEM_ID}/tags`);
        expect(await expectBare(items)).toContain('Urgent now');
        expect(await expectBare(await call('GET', `/api/inspections/${SOURCE_ID}/tags`))).toContain('Urgent now');
    });

    it('defect categories: create, update and list answer without the company id', async () => {
        const created = await call('POST', '/api/admin/defect-categories', { name: 'Cosmetic' });
        const category = (JSON.parse(await expectBare(created)) as { data: { id: string } }).data;
        expect(await heldBy('defectCategories', category.id)).toBe(TENANT_ID);
        await expectBare(await call('PUT', `/api/admin/defect-categories/${category.id}`, { name: 'Cosmetic only' }));
        expect(await expectBare(await call('GET', '/api/admin/defect-categories'))).toContain('Cosmetic only');
    });

    it('the agent reports of a seated agent answer without the company id', async () => {
        await h.db.insert(schema.contacts).values({ id: AGENT_CONTACT, tenantId: TENANT_ID, type: 'agent', name: 'Jane', email: 'jane@realty.test', createdAt: new Date() });
        await new PeopleService({ DB: h.env.DB }).addPerson(TENANT_ID, SOURCE_ID, AGENT_CONTACT, `crp_${TENANT_ID}_buyer_agent`);
        const text = await expectBare(await call('GET', `/api/agent/my-reports?agentId=${AGENT_CONTACT}`));
        expect(text).toContain(SOURCE_ID);
        expect(await heldBy('inspections', SOURCE_ID)).toBe(TENANT_ID);
        expect(await heldBy('contacts', AGENT_CONTACT)).toBe(TENANT_ID);
    });

    it('the dashboard answers its bucket rows without the company id', async () => {
        const text = await expectBare(await call('GET', '/api/inspections/dashboard'));
        expect(text).toContain(SOURCE_ID);
        expect(await heldBy('inspections', SOURCE_ID)).toBe(TENANT_ID);
    });

    describe('routes that return a record of the inspection or its people', () => {
        it('hub, events, list, results and the request lookup carry no company id', async () => {
            await expectBare(await call('GET', `/api/inspections/${SOURCE_ID}/hub`));
            await expectBare(await call('GET', `/api/inspections/${SOURCE_ID}/events`));
            await expectBare(await call('GET', '/api/inspections'));
            const now = new Date();
            await h.db.insert(schema.inspectionRequests).values({
                id: 'req-1', tenantId: TENANT_ID, clientName: 'Pat Buyer', propertyAddress: '7 Source Road', scheduledAt: now, status: 'pending', createdAt: now, updatedAt: now,
            } as never);
            await h.db.update(schema.inspections).set({ requestId: 'req-1' }).where(eq(schema.inspections.id, SOURCE_ID));
            expect(await heldBy('inspectionRequests', 'req-1')).toBe(TENANT_ID);
            const request = await call('GET', `/api/inspection-requests/by-inspection/${SOURCE_ID}`);
            expect(await expectBare(request, [200])).toContain('req-1');
            await expectBare(await call('GET', '/api/inspection-requests'));
            await expectBare(await call('GET', '/api/inspection-requests/req-1'));
        });

        it('contacts and the invoice list carry no company id', async () => {
            await h.db.insert(schema.contacts).values({ id: 'client-1', tenantId: TENANT_ID, type: 'client', name: 'Pat', email: 'pat@example.test', createdAt: new Date() });
            await h.db.insert(schema.invoices).values({
                id: 'inv-1', tenantId: TENANT_ID, inspectionId: SOURCE_ID, contactId: 'client-1', amountCents: 52000, status: 'draft', createdAt: new Date(),
            } as never);
            expect(await heldBy('contacts', 'client-1')).toBe(TENANT_ID);
            expect(await heldBy('invoices', 'inv-1')).toBe(TENANT_ID);
            await expectBare(await call('GET', '/api/contacts/client-1'));
            await expectBare(await call('GET', '/api/contacts'));
            await expectBare(await call('GET', '/api/invoices'));
        });
    });

    describe('write paths of contacts, invoices and inspection requests', () => {
        const idOf = (text: string, pick: (body: never) => unknown): string => String(pick(JSON.parse(text) as never));

        it('creating and updating a contact answers without the company id', async () => {
            const created = await expectBare(await call('POST', '/api/contacts', { name: 'Pat Buyer', email: 'pat.buyer@example.test', type: 'client' }), [201]);
            const id = idOf(created, (b: { data: { contact: { id: string } } }) => b.data.contact.id);
            expect(await heldBy('contacts', id)).toBe(TENANT_ID);
            await expectBare(await call('PUT', `/api/contacts/${id}`, { name: 'Pat B. Buyer' }), [200]);
        });

        it('creating an invoice answers without the company id', async () => {
            const created = await expectBare(await call('POST', '/api/invoices', { inspectionId: SOURCE_ID, clientName: 'Pat Buyer', amountCents: 52000, lineItems: [] }), [201]);
            const id = idOf(created, (b: { data: { invoice: { id: string } } }) => b.data.invoice.id);
            expect(await heldBy('invoices', id)).toBe(TENANT_ID);
        });

        it('creating, updating and appending to an inspection request answer without the company id', async () => {
            const request = {
                clientName: 'Pat Buyer', propertyAddress: '99 Request Road, Anytown', scheduledAt: '2026-06-15T09:00:00Z',
                subInspections: [{ templateId: TEMPLATE_ID, price: 30000 }],
            };
            const created = await expectBare(await call('POST', '/api/inspection-requests', request), [201]);
            const id = idOf(created, (b: { data: { request: { id: string } } }) => b.data.request.id);
            expect(await heldBy('inspectionRequests', id)).toBe(TENANT_ID);
            await expectBare(await call('PUT', `/api/inspection-requests/${id}`, { notes: 'Call before arriving' }), [200]);
            const appended = await expectBare(await call('POST', `/api/inspection-requests/${id}/inspections`, { templateId: TEMPLATE_ID, price: 15000 }), [200, 201]);
            expect(appended).toContain(id);
        });
    });
});
