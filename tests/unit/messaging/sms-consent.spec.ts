import { describe, it, expect, beforeEach } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();
import { SmsConsentService } from '../../../server/services/sms-consent.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CONTACT = 'contact-1';
let db: BetterSQLite3Database<typeof schema>;
let svc: SmsConsentService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    testD1.use(db);
    svc = new SmsConsentService(testD1.binding);
    await svc.publishDisclosure('By providing your number you agree to receive texts.');
});

describe('SmsConsentService', () => {
    it('no event → getLatest is null', async () => {
        expect(await svc.getLatest(TENANT, CONTACT)).toBeNull();
    });
    it('grant then revoke → latest wins (revoked)', async () => {
        await svc.record(TENANT, CONTACT, 'granted', 'booking_form', {});
        expect(await svc.getLatest(TENANT, CONTACT)).toBe('granted');
        await svc.record(TENANT, CONTACT, 'revoked', 'admin', {});
        expect(await svc.getLatest(TENANT, CONTACT)).toBe('revoked');
    });
    it('record stamps the current disclosure version', async () => {
        const row = await svc.record(TENANT, CONTACT, 'granted', 'optin_link', { ip: '1.2.3.4' });
        expect(row.disclosureVersion).toBe(1);
        expect(row.capturedVia).toBe('optin_link');
    });
});
