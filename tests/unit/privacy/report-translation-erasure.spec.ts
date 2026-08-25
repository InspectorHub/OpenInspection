/**
 * `report_translations.content` is a translation of inspector prose about a
 * named property for a named client: derived personal data. It was in no
 * erasure rule and no retention rule, and `lint:erasure` was green over it —
 * `PII_HEURISTIC` matches none of the table's eleven column names, so the gate
 * could not see the column at all.
 *
 * A derived copy of governed data that is itself ungoverned is the gap. Its
 * parent columns were already answered: `reports.title` and
 * `reports.inspector_narrative` are both erase-in-place under Art. 17(3)(e).
 *
 * ⚠️ Every assertion here is paired. A broken orchestrator that deletes NOTHING
 * and one that deletes EVERYTHING both satisfy "the subject's row is gone" or
 * "another tenant's row survives" on its own; only the pair separates them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { ERASURE_MANIFEST } from '../../../server/lib/compliance/erasure-manifest';
import { RETENTION_MANIFEST, RETENTION_OUT_OF_SCOPE } from '../../../server/lib/compliance/retention-manifest';
import { ACCOUNT_EXPORT_CLASSIFICATION } from '../../../server/lib/compliance/account-export-manifest';
import { runErasure } from '../../../server/lib/compliance/erasure-orchestrator';

const TENANT = 'tenant-erase';
const OTHER_TENANT = 'tenant-bystander';
const SUBJECT_EMAIL = 'subject@example.test';

const COMPLIANCE = path.resolve(__dirname, '../../../server/lib/compliance');
const orchestratorSource = fs.readFileSync(path.join(COMPLIANCE, 'erasure-orchestrator.ts'), 'utf8');
const executorSource = fs.readFileSync(path.join(COMPLIANCE, 'erase-report-artifacts.ts'), 'utf8');
const exportManifestSource = fs.readFileSync(path.join(COMPLIANCE, 'account-export-manifest.ts'), 'utf8');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

async function seedTranslation(tenantId: string, reportId: string, id: string) {
    await db.insert(schema.reportTranslations).values({
        id,
        tenantId,
        reportId,
        locale: 'es-419',
        content: JSON.stringify(['Mancha de humedad en el alero.']),
        source: 'openai-compatible:byo',
        englishHash: 'hash-en',
        translatedHash: 'hash-es',
        noticeVersion: 1,
        aiCallId: `call-${id}`,
        generatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
}

beforeEach(async () => {
    const created = createTestDb();
    await setupSchema(created.sqlite);
    db = created.db;
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    for (const [id, slug] of [[TENANT, 'erase-me'], [OTHER_TENANT, 'bystander']] as const) {
        await db.insert(schema.tenants).values({
            id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    }

    // The subject, their inspection, and the report that was translated.
    await db.insert(schema.contacts).values({
        id: 'contact-1', tenantId: TENANT, name: 'A Subject', email: SUBJECT_EMAIL,
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.inspections).values({
        id: 'insp-1', tenantId: TENANT, propertyAddress: '1 Subject Way', date: '2026-08-24',
        status: 'completed', createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.inspectionPeople).values({
        id: 'ip-1', tenantId: TENANT, inspectionId: 'insp-1', contactId: 'contact-1',
        roleProfileId: `crp_${TENANT}_client`, createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.reports).values({
        id: 'report-1', tenantId: TENANT, inspectionId: 'insp-1', kind: 'primary',
        title: 'Inspection report', status: 'published', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await seedTranslation(TENANT, 'report-1', 'trans-subject');

    // A bystander: another tenant's translation, which the same run must not
    // touch. Without it, an orchestrator that deleted the whole table would
    // pass every other assertion in this file.
    await db.insert(schema.inspections).values({
        id: 'insp-2', tenantId: OTHER_TENANT, propertyAddress: '2 Other Way', date: '2026-08-24',
        status: 'completed', createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.reports).values({
        id: 'report-2', tenantId: OTHER_TENANT, inspectionId: 'insp-2', kind: 'primary',
        title: 'Inspection report', status: 'published', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await seedTranslation(OTHER_TENANT, 'report-2', 'trans-bystander');
});

describe('report_translations carries an erasure rule', () => {
    it('has a rule for the content column', () => {
        const rule = ERASURE_MANIFEST.find(
            (r) => r.table === 'report_translations' && r.column === 'content',
        );
        expect(rule, 'no ERASURE_MANIFEST rule for report_translations.content').toBeDefined();
    });

    it('DELETES the row rather than erasing the column in place', () => {
        // Both are defensible and the design must not leave it open. The row
        // doubles as the opt-in record, so deleting it turns "previously
        // translated, currently withheld" into "never translated" — which is
        // the state the report is genuinely in once the English it described
        // has been erased around it. A workflow convenience is not a reason to
        // keep a derived copy through a subject erasure.
        const rule = ERASURE_MANIFEST.find(
            (r) => r.table === 'report_translations' && r.column === 'content',
        );
        expect(rule?.action).toBe('delete');
        // Nothing is retained, so nothing claims an Art. 17(3) exemption.
        expect(rule?.legalBasis).toBeUndefined();
    });

    it('is bound to an executor by TABLE and COLUMN, not by the column name alone', () => {
        // ⚠️ The drift spec can pass falsely here: the word `content` already
        // occurs in the orchestrator source on account of other tables, so an
        // assertion on the column name alone was green before this rule
        // existed. Assert on the pair — the drizzle table object AND the
        // step label naming the table.
        expect(executorSource).toContain('reportTranslations');
        expect(executorSource).toMatch(/step\(\s*'report_translations'/);
        // And the executor only counts if the orchestrator calls it: a rule
        // with an unreferenced executor is a rule that never runs.
        expect(orchestratorSource).toContain('eraseReportTranslations(');
    });
});

describe('the orchestrator removes the subject\'s translations', () => {
    it('deletes the row, and leaves another tenant\'s row standing', async () => {
        await runErasure(db, {
            tenantId: TENANT,
            subjectEmail: SUBJECT_EMAIL,
            retentionYears: 6,
        });

        const rows = await db.select().from(schema.reportTranslations).all();
        const ids = rows.map((r: { id: string }) => r.id);
        // The negative: the subject's translation is gone.
        expect(ids).not.toContain('trans-subject');
        // The positive control, in the same call: the bystander survives, so
        // "gone" is not "the orchestrator emptied the table".
        expect(ids).toContain('trans-bystander');
    });
});

describe('retention and export both answer for the table', () => {
    it('has a retention answer: DERIVED, not an independent window', () => {
        // A translation has no lifetime of its own — it dies with the document
        // it translates. Declaring a window nobody applies would be worse than
        // silence, so the entry is an out-of-scope one that names what actually
        // removes the row.
        const declared = RETENTION_OUT_OF_SCOPE.find((r) => r.table === 'report_translations');
        expect(declared, 'no retention answer for report_translations').toBeDefined();
        expect(declared!.reason.length).toBeGreaterThan(100);
        // And NOT an independent clock, which is the thing being ruled out.
        expect(RETENTION_MANIFEST.find((r) => r.table === 'report_translations')).toBeUndefined();
        // Positive control: the catalogue still holds real windowed rules, so
        // "not in RETENTION_MANIFEST" is not "the manifest is empty".
        expect(RETENTION_MANIFEST.length).toBeGreaterThan(5);
    });

    it('has an account-export answer, written down rather than left absent', () => {
        // The answer is that the account export carries no report content at
        // all — not the English half either — so there is no asymmetry to fix
        // and a table row does not belong in a catalogue of `users` columns.
        // What matters is that the question was asked and recorded.
        expect(exportManifestSource).toContain('report_translations');
        // The positive control: that module still classifies users columns, so
        // the assertion above is about a scope note and not about a stray entry.
        expect(ACCOUNT_EXPORT_CLASSIFICATION.length).toBeGreaterThan(5);
        expect(ACCOUNT_EXPORT_CLASSIFICATION.every((r) => typeof r.column === 'string')).toBe(true);
    });
});
