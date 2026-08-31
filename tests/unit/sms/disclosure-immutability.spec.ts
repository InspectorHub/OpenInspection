import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { sha256Hex } from '../../../server/lib/sha256';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { SmsConsentService } from '../../../server/services/sms-consent.service';
import { AutomationService } from '../../../server/services/automation.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const SUBJECT = 'contact-1';
let db: BetterSQLite3Database<typeof schema>;
let svc: SmsConsentService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    svc = new SmsConsentService({} as D1Database);
});

const versionRow = (version: number) => db.select().from(schema.smsDisclosureVersions)
    .where(eq(schema.smsDisclosureVersions.version, version)).get();

describe('disclosure versions are immutable and hashed', () => {
    it('publishing computes and stores a content hash of the text it published', async () => {
        const text = 'By providing your phone number you agree to receive texts.';
        const v = await svc.publishDisclosure(text);
        const row = await versionRow(v);
        expect(row?.contentHash).toMatch(/^[0-9a-f]{64}$/);
        // Not just "some hash": the hash must be OF the stored text, otherwise the
        // column proves nothing about what a consumer was shown.
        expect(row?.contentHash).toBe(await sha256Hex(text));
    });

    it('republishing identical text is a no-op rather than a new version', async () => {
        const a = await svc.publishDisclosure('same words');
        const b = await svc.publishDisclosure('same words');
        expect(b).toBe(a);
        const all = await db.select().from(schema.smsDisclosureVersions);
        expect(all).toHaveLength(1);
    });

    it('publishing different text still mints a new version', async () => {
        // The positive control for the no-op above: a de-duplicating publish that
        // de-duplicated EVERYTHING would pass that test and break the feature.
        const a = await svc.publishDisclosure('first wording');
        const b = await svc.publishDisclosure('second wording');
        expect(b).toBe(a + 1);
        expect(await db.select().from(schema.smsDisclosureVersions)).toHaveLength(2);
    });

    it('the consent row stores the hash, not only the pointer', async () => {
        await svc.publishDisclosure('v1 text');
        const row = await svc.record(TENANT, SUBJECT, 'granted', 'booking_form', {});
        expect(row.disclosureContentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.disclosureContentHash).toBe(await sha256Hex('v1 text'));
        const stored = await db.select().from(schema.smsConsentLog)
            .where(eq(schema.smsConsentLog.id, row.id)).get();
        expect(stored?.disclosureContentHash).toBe(row.disclosureContentHash);
    });

    it('a consent recorded with no disclosure at all stores no hash rather than a fake one', async () => {
        const row = await svc.record(TENANT, SUBJECT, 'revoked', 'admin', {});
        expect(row.disclosureVersion).toBe(0);
        expect(row.disclosureContentHash).toBeNull();
    });

    it('editing a published version is refused', async () => {
        const v = await svc.publishDisclosure('original');
        await expect(svc.amendDisclosure(v, 'rewritten')).rejects.toThrow(/immutable/i);
        const row = await versionRow(v);
        expect(row?.text).toBe('original');
    });

    it('the seeding path hashes too — there is a second insert, and it is not exempt', async () => {
        // The disclosure ledger has more than one writer. A hash that only the
        // publish path computes leaves the seeded row — the one nearly every
        // deployment actually consents against — carrying nothing.
        const automation = new AutomationService({} as D1Database);
        await automation.ensureSmsDisclosureV1();
        const row = await versionRow(1);
        expect(row?.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(row?.contentHash).toBe(await sha256Hex(row!.text));
    });

    it('seeding twice still leaves exactly one version', async () => {
        const automation = new AutomationService({} as D1Database);
        await automation.ensureSmsDisclosureV1();
        await automation.ensureSmsDisclosureV1();
        expect(await db.select().from(schema.smsDisclosureVersions)).toHaveLength(1);
    });

    it('seeding never overwrites a tenant-published later version', async () => {
        const v = await svc.publishDisclosure('a wording someone chose deliberately');
        const automation = new AutomationService({} as D1Database);
        await automation.ensureSmsDisclosureV1();
        const all = await db.select().from(schema.smsDisclosureVersions);
        expect(all).toHaveLength(1);
        expect(all[0]!.version).toBe(v);
    });
});
