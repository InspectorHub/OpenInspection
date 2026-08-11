import { describe, it, expect, beforeEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { SubjectExportService } from '../../../server/services/subject-export.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * Privacy P3 — the subject SAR archive (`cmd.subject.export`).
 *
 * The archive is what a data subject actually receives, so the properties worth
 * asserting are the ones a wrong answer would be invisible on: that the tenant
 * boundary holds, that a second person's records do not travel, that live bearer
 * tokens are not shipped in a file, and that the phone axis genuinely widens the
 * match set rather than being carried and dropped.
 */

const TENANT_A = '00000000-0000-0000-0000-0000000000a1';
const TENANT_B = '00000000-0000-0000-0000-0000000000b1';
const SUBJECT = 'subject@example.com';
const SUBJECT_PHONE = '+15555550123';
const OTHER = 'other@example.com';

interface FakeUpload { zip: () => Uint8Array | null; aborted: () => boolean; bucket: R2Bucket }

function fakeExportsBucket(): FakeUpload {
    const parts = new Map<number, Uint8Array>();
    let done: Uint8Array | null = null;
    let aborted = false;
    const bucket = {
        createMultipartUpload: async () => ({
            uploadPart: async (n: number, body: Uint8Array) => {
                parts.set(n, body);
                return { partNumber: n, etag: `etag-${n}` };
            },
            complete: async () => {
                const ordered = [...parts.keys()].sort((a, b) => a - b).map((k) => parts.get(k)!);
                const out = new Uint8Array(ordered.reduce((n, c) => n + c.length, 0));
                let offset = 0;
                for (const c of ordered) { out.set(c, offset); offset += c.length; }
                done = out;
            },
            abort: async () => { aborted = true; },
        }),
    };
    return { bucket: bucket as unknown as R2Bucket, zip: () => done, aborted: () => aborted };
}

function fakePhotosBucket(objects: Record<string, string>): R2Bucket {
    return {
        list: async ({ prefix }: { prefix: string }) => ({
            objects: Object.keys(objects).filter((k) => k.startsWith(prefix))
                .map((k) => ({ key: k, size: objects[k]!.length })),
            truncated: false,
        }),
        get: async (key: string) => (objects[key] == null ? null : {
            body: new ReadableStream<Uint8Array>({
                start(c) { c.enqueue(new TextEncoder().encode(objects[key]!)); c.close(); },
            }),
        }),
    } as unknown as R2Bucket;
}

function readArchive(bytes: Uint8Array): Record<string, string> {
    const files = unzipSync(bytes);
    return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

describe('SubjectExportService', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values([
            { id: TENANT_A, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: TENANT_B, name: 'B', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await seedRoleProfiles(asD1Db(db), TENANT_A, new Date(1));
        await seedRoleProfiles(asD1Db(db), TENANT_B, new Date(1));

        // Tenant A: the subject, on one inspection, with a portal access token.
        await db.insert(schema.contacts).values([
            { id: 'c-subject', tenantId: TENANT_A, type: 'client', name: 'Subject', email: SUBJECT, phone: SUBJECT_PHONE, createdAt: new Date() },
            { id: 'c-other', tenantId: TENANT_A, type: 'client', name: 'Other', email: OTHER, phone: '+15555559999', createdAt: new Date() },
        ]);
        await db.insert(schema.inspections).values([
            { id: 'insp-subject', tenantId: TENANT_A, propertyAddress: '1 Main St', date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 50000, createdAt: new Date() },
            { id: 'insp-other', tenantId: TENANT_A, propertyAddress: '2 Elm St', date: '2026-06-02', status: 'completed', paymentStatus: 'unpaid', price: 50000, createdAt: new Date() },
        ]);
        await db.insert(schema.inspectionPeople).values([
            { id: 'ip-1', tenantId: TENANT_A, inspectionId: 'insp-subject', contactId: 'c-subject', roleProfileId: `crp_${TENANT_A}_client`, createdAt: new Date() },
            { id: 'ip-2', tenantId: TENANT_A, inspectionId: 'insp-other', contactId: 'c-other', roleProfileId: `crp_${TENANT_A}_client`, createdAt: new Date() },
        ]);
        await db.insert(schema.inspectionAccessTokens).values({
            id: 'tok-1', tenantId: TENANT_A, inspectionId: 'insp-subject', recipientEmail: SUBJECT,
            role: 'client', token: 'live-bearer-token-do-not-ship', createdAt: new Date(),
        });
        // Booking request reachable ONLY by phone — the email on it is different.
        await db.insert(schema.inspectionRequests).values({
            id: 'req-phone', tenantId: TENANT_A, clientName: 'Subject', clientEmail: 'typo@example.com',
            clientPhone: SUBJECT_PHONE, propertyAddress: '1 Main St', status: 'pending',
            scheduledAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        });

        // Tenant B: the SAME person, in a workspace this export must not reach.
        await db.insert(schema.contacts).values({
            id: 'c-subject-b', tenantId: TENANT_B, type: 'client', name: 'Subject', email: SUBJECT, phone: SUBJECT_PHONE, createdAt: new Date(),
        });
    });

    async function run(subjectPhone?: string) {
        const exports = fakeExportsBucket();
        const photos = fakePhotosBucket({
            [`${TENANT_A}/inspections/insp-subject/photos/p1.jpg`]: 'subject-photo-bytes',
            [`${TENANT_A}/inspections/insp-other/photos/p2.jpg`]: 'other-photo-bytes',
        });
        const svc = new SubjectExportService(db, photos);
        const manifest = await svc.buildZipToR2(
            { tenantId: TENANT_A, subjectEmail: SUBJECT, ...(subjectPhone ? { subjectPhone } : {}) },
            exports.bucket,
            'dsar/a/req-1.zip',
        );
        const bytes = exports.zip();
        expect(bytes, 'multipart upload never completed').not.toBeNull();
        return { manifest, files: readArchive(bytes!), exports };
    }

    it('writes one JSON file per collection, including the empty ones', async () => {
        const { files } = await run();
        const names = Object.keys(files).filter((f) => f.startsWith('data/')).sort();
        // eslint-disable-next-line no-console
        console.log(`[subject-export] ${names.length} collections written: ${names.join(', ')}`);
        expect(names.length).toBeGreaterThan(10);
        expect(names).toContain('data/contacts.json');
        // An absent file would read as "we did not look"; an empty array says
        // the table was searched and held nothing.
        expect(JSON.parse(files['data/email_suppressions.json']!)).toEqual([]);
        expect(files['README.txt']).toContain(SUBJECT);
    });

    it('contains the subject and NOT the other person on the same tenant', async () => {
        const { files } = await run();
        const contacts = JSON.parse(files['data/contacts.json']!) as { email: string }[];
        expect(contacts.map((c) => c.email)).toEqual([SUBJECT]);
        const inspections = JSON.parse(files['data/inspections.json']!) as { id: string }[];
        expect(inspections.map((i) => i.id)).toEqual(['insp-subject']);
    });

    it('never crosses the tenant boundary, even for the same email', async () => {
        const { files } = await run();
        const contacts = JSON.parse(files['data/contacts.json']!) as { id: string }[];
        expect(contacts.map((c) => c.id)).toEqual(['c-subject']);
        expect(files['data/contacts.json']).not.toContain('c-subject-b');
    });

    it('redacts live bearer tokens — a SAR is not a credential handout', async () => {
        const { files } = await run();
        const tokens = JSON.parse(files['data/inspection_access_tokens.json']!) as { token: string; recipientEmail: string }[];
        expect(tokens).toHaveLength(1);
        expect(tokens[0]!.recipientEmail).toBe(SUBJECT);
        expect(tokens[0]!.token).toBe('[redacted]');
        // The whole archive, not just that one field.
        expect(JSON.stringify(files)).not.toContain('live-bearer-token-do-not-ship');
    });

    it('the phone axis widens the match set — a booking reachable only by phone', async () => {
        const emailOnly = await run();
        const withPhone = await run(SUBJECT_PHONE);
        const emailBookings = JSON.parse(emailOnly.files['data/inspection_requests.json']!) as unknown[];
        const phoneBookings = JSON.parse(withPhone.files['data/inspection_requests.json']!) as { id: string }[];
        // eslint-disable-next-line no-console
        console.log(`[subject-export] bookings matched: email-only=${emailBookings.length}, with-phone=${phoneBookings.length}`);
        expect(emailBookings).toHaveLength(0);
        expect(phoneBookings.map((b) => b.id)).toEqual(['req-phone']);
        expect(withPhone.manifest.rows).toBeGreaterThan(emailOnly.manifest.rows);
    });

    it('embeds only the subject inspections photos, and counts them honestly', async () => {
        const { manifest, files } = await run();
        expect(manifest.photos).toBe(1);
        expect(manifest.photosEmbedded).toBe(1);
        expect(files[`photos/${TENANT_A}/inspections/insp-subject/photos/p1.jpg`]).toBe('subject-photo-bytes');
        expect(Object.keys(files).some((f) => f.includes('insp-other'))).toBe(false);
    });

    it('a photo that cannot be read is skipped, not fatal, and says so in the manifest', async () => {
        const exports = fakeExportsBucket();
        const photos = {
            list: async ({ prefix }: { prefix: string }) => ({
                objects: prefix.includes('insp-subject')
                    ? [{ key: `${TENANT_A}/inspections/insp-subject/photos/gone.jpg`, size: 10 }]
                    : [],
                truncated: false,
            }),
            get: async () => { throw new Error('R2 unavailable'); },
        } as unknown as R2Bucket;
        const manifest = await new SubjectExportService(db, photos)
            .buildZipToR2({ tenantId: TENANT_A, subjectEmail: SUBJECT }, exports.bucket, 'dsar/a/req-2.zip');
        expect(manifest.photos).toBe(1);
        expect(manifest.photosEmbedded).toBe(0);
        const files = readArchive(exports.zip()!);
        const listed = JSON.parse(files['photos-manifest.json']!) as { included: boolean }[];
        expect(listed[0]!.included).toBe(false);
    });

    it('a subject with nothing held still produces a complete, readable archive', async () => {
        const exports = fakeExportsBucket();
        const manifest = await new SubjectExportService(db, fakePhotosBucket({}))
            .buildZipToR2({ tenantId: TENANT_A, subjectEmail: 'nobody@example.com' }, exports.bucket, 'dsar/a/req-3.zip');
        expect(manifest.rows).toBe(0);
        const files = readArchive(exports.zip()!);
        expect(files['README.txt']).toContain('No records matched this subject');
        expect(JSON.parse(files['data/contacts.json']!)).toEqual([]);
    });
});
