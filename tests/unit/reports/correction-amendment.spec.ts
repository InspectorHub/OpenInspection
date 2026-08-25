/**
 * Correcting a signed report — by amendment, and across every live deliverable.
 *
 * Editing a published report in place would destroy the distinction between
 * HISTORICAL AUTHENTICITY (what was delivered, signed, and hash-chained) and
 * CURRENT CORRECTNESS (what is true now). So a correction publishes version
 * N+1 and leaves N exactly as it was.
 *
 * That is only half of it. The signing workflow leaves THREE files in object
 * storage that the product serves back on request — the signed PDF, the
 * certificate, and the evidence zip — and each is fetched by its own helper
 * running its own `r2.get`. There is no shared fetch layer, so "added a
 * header" and "added three headers" are different facts and nothing in
 * `evidence.ts` will tell you which one you did. Hence `it.each` over all
 * three, with the count asserted as a number rather than left implicit.
 *
 * Two shapes this file deliberately guards against:
 *
 *   1. **A negative assertion that passes because nothing happened.**
 *      `headers.get()` returns null for a header that is absent AND for a
 *      response that was never produced, so every "is not current" assertion
 *      is paired with a positive control asserting the OTHER value on an
 *      uncorrected envelope. An artefact that is superseded and one that was
 *      never classified must not read the same.
 *
 *   2. **A header the cache can outlive.** All three responses used to carry
 *      `private, max-age=300`, so a copy fetched a minute before a correction
 *      kept claiming `current` for the next five. A status header is a claim
 *      about right now; it is only true if the response cannot be reused
 *      without asking again.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { ReportVersionService } from '../../../server/services/report-version.service';
import { correctReport } from '../../../server/services/report-correction.service';
import {
    artifactClass,
    classifyByShape,
    liveDeliverableKeys,
    LIVE_DELIVERABLE_FILES,
} from '../../../server/lib/artifact-status';
import {
    downloadAgreementPdf,
    downloadCertPdf,
    downloadEvidenceZip,
} from '../../../server/api/evidence';

const TENANT       = '00000000-0000-0000-0000-000000000001';
const INSPECTION   = '00000000-0000-0000-0000-000000000010';
const OTHER_INSP   = '00000000-0000-0000-0000-000000000011';
const AGREEMENT    = '00000000-0000-0000-0000-000000000020';
const ENVELOPE     = '00000000-0000-0000-0000-000000000030';
const UNCORRECTED  = '00000000-0000-0000-0000-000000000031';
const ACTOR        = '00000000-0000-0000-0000-0000000000aa';
const SECRET       = 'test-encryption-secret-key';

/** Long before anything this file does — so an amendment published "now" is
 *  unambiguously later than the artefact it supersedes. */
const SIGNED_AT = new Date('2026-01-01T00:00:00.000Z');

/** The three helpers, each named, so a failure says WHICH deliverable. */
const HELPERS = [
    ['signed.pdf', downloadAgreementPdf],
    ['certificate.pdf', downloadCertPdf],
    ['evidence.zip', downloadEvidenceZip],
] as const;

/**
 * ⚠️ The field is `propertyAddress`, not the client's name.
 *
 * `inspections` carries no client columns — they were dropped in favour of
 * `inspection_people` → `contacts`, which every reader joins at read time. A
 * contact edit therefore reaches every surface on its own and needs no
 * amendment. What DOES need one is a field frozen into the signed snapshot,
 * and the property address is one.
 */
const CORRECTION = {
    tenantId: TENANT,
    inspectionId: INSPECTION,
    field: 'propertyAddress',
    to: '1 Main Street',
    reason: 'Correction request from the subject of the record',
    correctedBy: ACTOR,
} as const;

function r2Stub(): R2Bucket {
    return {
        get: vi.fn().mockResolvedValue({ body: new Uint8Array([1, 2, 3]).buffer }),
    } as unknown as R2Bucket;
}

describe('a signed report is corrected by amendment', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: ReportVersionService;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        for (const id of [INSPECTION, OTHER_INSP]) {
            await db.insert(schema.inspections).values({
                id, tenantId: TENANT, propertyAddress: '1 Main St',
                date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
                price: 0, paymentRequired: false, agreementRequired: false,
                createdAt: new Date(),
            });
        }
        await db.insert(schema.agreements).values({
            id: AGREEMENT, tenantId: TENANT, name: 'Standard Agreement',
            content: 'The parties agree.', version: 1, createdAt: new Date(),
        });
        await db.insert(schema.agreementRequests).values([
            {
                id: ENVELOPE, tenantId: TENANT, inspectionId: INSPECTION,
                agreementId: AGREEMENT, clientEmail: 'anne@example.com',
                status: 'signed', signedAt: SIGNED_AT, createdAt: SIGNED_AT,
            },
            {
                id: UNCORRECTED, tenantId: TENANT, inspectionId: OTHER_INSP,
                agreementId: AGREEMENT, clientEmail: 'anne@example.com',
                status: 'signed', signedAt: SIGNED_AT, createdAt: SIGNED_AT,
            },
        ]);

        svc = new ReportVersionService({} as D1Database, SECRET);
    });

    const correct = (extra: Record<string, unknown> = {}) =>
        correctReport({} as D1Database, SECRET, { ...CORRECTION, ...extra });

    it('publishes a new version and never mutates the one already delivered', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, ACTOR);
        const before = await svc.get(TENANT, INSPECTION, 1);
        expect(before?.inspection?.propertyAddress).toBe('1 Main St');

        const out = await correct();
        expect(out.versionNumber).toBe(2);

        // The delivered version is byte-identical to what it was.
        expect(await svc.get(TENANT, INSPECTION, 1)).toEqual(before);

        const v2 = await svc.get(TENANT, INSPECTION, 2);
        expect(v2?.inspection?.propertyAddress).toBe('1 Main Street');

        const row = await db.select().from(schema.reportVersions)
            .where(and(
                eq(schema.reportVersions.inspectionId, INSPECTION),
                eq(schema.reportVersions.versionNumber, 2),
            )).get();
        expect(row?.isAmendment).toBe(true);
        expect(row?.summary).toBe(CORRECTION.reason);
    });

    it('records the delivered state first when nothing was ever published', async () => {
        // Without this, a correction on a never-published report writes version
        // 1, `isAmendment` is false, and the artefacts below stay `current`
        // forever — the correction graph would simply not see it.
        const out = await correct();
        expect(out.versionNumber).toBe(2);
        expect((await svc.get(TENANT, INSPECTION, 1))?.inspection?.propertyAddress).toBe('1 Main St');
        expect((await svc.get(TENANT, INSPECTION, 2))?.inspection?.propertyAddress).toBe('1 Main Street');
    });

    it.each(HELPERS)('serves the superseded %s as historical, not as current', async (_file, download) => {
        await correct();
        const res = await download({} as D1Database, r2Stub(), ENVELOPE, TENANT);
        // Positive control: still retrievable. The old artefact remains
        // available as evidence; what changes is what it claims to be.
        expect(res.status).toBe(200);
        expect(res.headers.get('x-artifact-status')).toBe('superseded');
    });

    it.each(HELPERS)('labels an uncorrected %s `current`, not merely unlabelled', async (_file, download) => {
        // The control for the block above. Without it, deleting the header
        // entirely would still satisfy "is not current".
        const res = await download({} as D1Database, r2Stub(), UNCORRECTED, TENANT);
        expect(res.status).toBe(200);
        expect(res.headers.get('x-artifact-status')).toBe('current');
    });

    it.each(HELPERS)('gives no cache a window in which %s can keep the old answer', async (_file, download) => {
        const fresh = await download({} as D1Database, r2Stub(), UNCORRECTED, TENANT);
        const cache = fresh.headers.get('cache-control') ?? '';
        // A status header is a claim about right now. `max-age=300` let a
        // response fetched before a correction go on claiming `current` for
        // five more minutes in the client's own cache.
        expect(cache).not.toMatch(/max-age=[1-9]/);
        expect(cache).toMatch(/no-cache|no-store/);
        expect(cache).toContain('private');

        await correct();
        const stale = await download({} as D1Database, r2Stub(), ENVELOPE, TENANT);
        expect(stale.headers.get('cache-control') ?? '').toMatch(/no-store/);
    });

    it('names all three live deliverables, and classifies none of them as an archive', () => {
        const keys = liveDeliverableKeys(TENANT, INSPECTION, ENVELOPE);
        // The count stated as a number: dropping one is a coverage regression
        // that no other assertion here would notice.
        expect(keys).toHaveLength(3);
        expect(keys).toEqual(LIVE_DELIVERABLE_FILES.map((f) =>
            `${TENANT}/inspections/${INSPECTION}/agreements/${ENVELOPE}/${f}`));
        for (const k of keys) expect(artifactClass(k)).toBe('live');

        // POSITIVE CONTROL: the classifier can say something other than
        // 'live'. Without this, `artifactClass = () => 'live'` passes the loop
        // above and the guard below becomes decorative.
        expect(artifactClass(`${TENANT}/inspections/${INSPECTION}/photos/x.jpg`)).toBe('unclassified');
    });

    it('reads the key by segments, so a filename cannot be read as a pattern', () => {
        // 🔴 The assertion that speaks on a day nobody has had yet. The
        // classifier used to interpolate the three names into a regex and
        // escape `.` by hand: correct for exactly those three, and silently
        // wrong for the first name anyone adds carrying another metacharacter.
        //
        // These are the shapes that would separate the two implementations. A
        // dot is NOT a wildcard, and a name that merely contains a live one is
        // not a live one — under the old pattern the first of these depended on
        // an escape somebody remembered to write.
        const base = `${TENANT}/inspections/${INSPECTION}/agreements/${ENVELOPE}`;
        expect(artifactClass(`${base}/signedXpdf`)).toBe('unclassified');
        expect(artifactClass(`${base}/not-signed.pdf`)).toBe('unclassified');
        expect(artifactClass(`${base}/evidence.zip.bak`)).toBe('unclassified');
        // The envelope segment must be there and non-empty: `/agreements/` on
        // its own is not an envelope's folder.
        expect(artifactClass(`${TENANT}/inspections/${INSPECTION}/agreements/signed.pdf`)).toBe('unclassified');
        expect(artifactClass(`${base}//signed.pdf`)).toBe('unclassified');
        // POSITIVE CONTROL, so the five above are not passing because the
        // classifier answers 'unclassified' to everything.
        expect(artifactClass(`${base}/signed.pdf`)).toBe('live');

        // ⚠️ And an admission the five above are worth less than they look:
        // fed to the regex-building version this replaced, every one of them
        // passes as well. They lock the behaviour; they do not discriminate.
        // The case that does is below, and it needs a name the constant does
        // not contain.
    });

    it('compares the filename, never interprets it', () => {
        // 🔴 The ONLY case here that tells the two implementations apart, which
        // is why the file set is injectable at all.
        //
        // The old classifier built `…(?:evidence+\.zip)$` from the names and
        // escaped only `.`. That leaves `+` a quantifier over the preceding
        // `e`, so it matched `evidencee.zip` — a key nobody has — and did NOT
        // match `evidence+.zip`, the actual file. Both answers wrong, nothing
        // failing. This asserts both directions.
        const files: ReadonlySet<string> = new Set(['evidence+.zip']);
        const base = `${TENANT}/inspections/${INSPECTION}/agreements/${ENVELOPE}`;
        expect(classifyByShape(`${base}/evidence+.zip`, files)).toBe('live');
        expect(classifyByShape(`${base}/evidencee.zip`, files)).toBe('unclassified');
    });

    it('refuses to defer a live deliverable rather than delaying the correction', async () => {
        // The only assertion here that speaks on a day nobody has had yet: it
        // fires the first time somebody labels one of these keys "archive" to
        // buy time. Nothing existing goes red when that happens.
        await expect(
            correct({ deferKeys: [liveDeliverableKeys(TENANT, INSPECTION, ENVELOPE)[0]] }),
        ).rejects.toThrow(/live deliverable .* not an archived or backup system/i);
    });

    it('refuses to defer an object it does not recognise either — fail closed', async () => {
        // The guard's other branch. `unclassified` is not a synonym for
        // "archive": it means nothing here can say what deferring that object
        // would mean, and an unknown is refused for that reason rather than
        // waved through.
        await expect(
            correct({ deferKeys: [`${TENANT}/inspections/${INSPECTION}/photos/x.jpg`] }),
        ).rejects.toThrow(/classifies no stored object as an archive or a backup/i);
    });

    it('still runs the correction when nothing is deferred — the control for the refusal', async () => {
        // Without this, a `correctReport` that threw unconditionally would
        // satisfy the assertion above.
        await expect(correct({ deferKeys: [] })).resolves.toMatchObject({ versionNumber: 2 });
    });

    it('leaves the hash chain verifying across the amendment', async () => {
        await svc.snapshotOnPublish(TENANT, INSPECTION, ACTOR);
        await correct();

        const v2 = await db.select().from(schema.reportVersions)
            .where(and(
                eq(schema.reportVersions.inspectionId, INSPECTION),
                eq(schema.reportVersions.versionNumber, 2),
            )).get();
        const out = await svc.verifyByToken(v2!.verificationToken!);
        expect(out?.chainValid).toBe(true);
        expect(out?.hashValid).toBe(true);
        expect(out?.isAmendment).toBe(true);
    });
});
