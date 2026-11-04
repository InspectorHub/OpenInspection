/**
 * Shared fixture of the audit export specs: four envelopes on four inspections (one with no stored postal code), and a request helper
 * that goes through the real application.
 */
import { app } from '../../../server/index';
import { makeExecutionContext } from './exec-ctx';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { TENANT_ID, type Harness } from './tenant-email-harness';

export const ENV1 = 'aaaaaaaa-0000-4000-8000-000000000001';
export const ENV2 = 'bbbbbbbb-0000-4000-8000-000000000002';
export const ENV3 = 'cccccccc-0000-4000-8000-000000000003';
export const ENV4 = 'dddddddd-0000-4000-8000-000000000004';
export const EMAIL1 = 'first.signer@example.test';
export const EMAIL1B = 'second.signer@example.test';
export const CLIENT_EMAIL = 'request.client@example.test';
export const EMAIL2 = 'other.signer@example.test';
export const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
export const REQUEST_OWN = 'req-own-60601';
export const REQUEST_OTHER_COMPANY = 'req-other-99999';
export const OTHER_COMPANY_ID = '99999999-0000-4000-8000-000000000009';

export async function seedEnvelopes(h: Harness): Promise<void> {
    const now = new Date();
    await h.db.insert(schema.agreements).values({ id: 'agr-1', tenantId: TENANT_ID, name: 'Standard agreement', content: 'Agreement text', version: 1, createdAt: now });
    const inspection = (id: string, zip: string | null) => h.db.insert(schema.inspections).values({
        id, tenantId: TENANT_ID, propertyAddress: `${id} Main Street`, addressZip: zip, date: '2026-06-01', status: 'requested',
        paymentStatus: 'unpaid', price: 0, createdAt: now,
    });
    await inspection('insp-1', '78701');
    await inspection('insp-2', '90210');
    await inspection('insp-3', 'K1A 0B1');
    await inspection('insp-4', null);
    // insp-4 has no postal code of its own but came from a request that has one; insp-3 points at a request of ANOTHER company.
    const request = (id: string, tenantId: string, zip: string | null) => h.db.insert(schema.inspectionRequests).values({
        id, tenantId, clientName: 'Request Client', propertyAddress: '1 Request Road', propertyZip: zip, scheduledAt: now, status: 'pending', createdAt: now, updatedAt: now,
    } as never);
    await h.db.insert(schema.tenants).values({ id: OTHER_COMPANY_ID, slug: 'other-company', status: 'active', tier: 'free', maxUsers: 5, deploymentMode: 'shared', createdAt: now });
    await request(REQUEST_OWN, TENANT_ID, '60601');
    await request(REQUEST_OTHER_COMPANY, OTHER_COMPANY_ID, '99999');
    await h.db.update(schema.inspections).set({ requestId: REQUEST_OWN }).where(eq(schema.inspections.id, 'insp-4'));
    await h.db.update(schema.inspections).set({ requestId: REQUEST_OTHER_COMPANY }).where(eq(schema.inspections.id, 'insp-3'));
    const envelope = async (id: string, inspectionId: string, clientEmail: string, signers: Array<[string, string]>) => {
        await h.db.insert(schema.agreementRequests).values({
            id, tenantId: TENANT_ID, inspectionId, agreementId: 'agr-1', clientEmail, status: 'signed', createdAt: now,
        } as never);
        for (const [name, email] of signers) {
            await h.db.insert(schema.agreementSigners).values({
                id: `${id}-${name}`, tenantId: TENANT_ID, requestId: id, name, email, role: 'client', status: 'signed', createdAt: now,
            } as never);
        }
        for (const [i, event] of (['request.created', 'signer.presented', 'agreement.signed'] as const).entries()) {
            await h.db.insert(schema.esignAuditLogs).values({
                id: `${id}-ev${i}`, tenantId: TENANT_ID, requestId: id, event, payloadJson: JSON.stringify({ n: i, signerEmail: signers[0]![1] }),
                prevHash: i === 0 ? null : `hash-${i - 1}`, hash: `hash-${i}`, signature: `sig-${i}`, keyFingerprint: 'fp-test', createdAt: new Date(now.getTime() + i),
            } as never);
        }
    };
    await envelope(ENV1, 'insp-1', CLIENT_EMAIL, [['First', EMAIL1], ['Second', EMAIL1B]]);
    await envelope(ENV2, 'insp-2', 'client.two@example.test', [['Other', EMAIL2]]);
    await envelope(ENV3, 'insp-3', 'client.three@example.test', [['Third', 'third.signer@example.test']]);
    await envelope(ENV4, 'insp-4', 'client.four@example.test', [['Fourth', 'fourth.signer@example.test']]);
}

export function poster(h: Harness) {
    return async (envelopeId: string, body: unknown, ip: string | null = '203.0.113.7'): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'verify-export' });
        const res = await app.request(`/api/public/verify/${envelopeId}/export`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
            body: typeof body === 'string' ? body : JSON.stringify(body),
        }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
}

export const withToken = (body: Record<string, unknown>) => ({ turnstileToken: TOKEN, ...body });

export interface DbWatch { log: string[]; writes: () => string[]; restore: () => void }

/**
 * Wraps the harness database so every prepared statement is recorded in order, and optionally throws for statements that mention a
 * table. Statements that write are the INSERT, UPDATE and DELETE ones.
 */
export function watchDb(h: Harness, throwOn?: string): DbWatch {
    const real = h.env.DB;
    const log: string[] = [];
    h.env.DB = new Proxy(real, {
        get(target, prop) {
            if (prop === 'prepare') {
                return (query: string) => {
                    log.push(query);
                    if (throwOn && query.includes(throwOn)) throw new Error(`store down: ${throwOn}`);
                    return target.prepare(query);
                };
            }
            const value = (target as unknown as Record<string | symbol, unknown>)[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    return {
        log,
        writes: () => log.filter((q) => /^\s*(insert|update|delete)\b/i.test(q)),
        restore: () => { h.env.DB = real; },
    };
}
