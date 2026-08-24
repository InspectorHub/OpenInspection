/**
 * The interchange vocabulary, checked as a declaration rather than as prose.
 *
 * `server/lib/data-exchange/` holds ONE manifest per entity, and both the CSV
 * export and the import mapping read it. That only buys anything if the
 * manifest itself is well formed, so the rules it has to keep are asserted
 * here: a field names itself completely, a round-trippable field advertises the
 * spelling the export actually writes, and a field an import cannot read back
 * advertises no spelling at all.
 *
 * Every negative assertion below is paired with a positive control in the same
 * result. An empty manifest — or one that is entirely `exportOnly` — satisfies
 * all three rules above while describing nothing, and a purity check that scans
 * zero files reports success on the day the directory is renamed.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONTACT_EXCHANGE } from '../../../server/lib/data-exchange/contacts';
import { MEMBER_EXCHANGE } from '../../../server/lib/data-exchange/members';
import { headerVocabulary, INTAKE_HEADERS } from '../../../server/lib/data-exchange/headers';
import type { ExchangeVocabulary } from '../../../server/lib/data-exchange/types';
import { CONTACT_HEADERS } from '../../../server/lib/migration-intake/adapters/registry';

const VOCABULARIES = [CONTACT_EXCHANGE, MEMBER_EXCHANGE];

describe('exchange vocabulary — every field is well formed', () => {
    it.each(VOCABULARIES)('$entity: each field names itself completely', (v: ExchangeVocabulary) => {
        for (const f of v.fields) {
            expect(f.field.length, `${v.entity}.${f.header}: field`).toBeGreaterThan(0);
            expect(f.column.length, `${v.entity}.${f.header}: column`).toBeGreaterThan(0);
            expect(f.header.length, `${v.entity}: a field with no header`).toBeGreaterThan(0);
            expect(f.reason.length, `${v.entity}.${f.header}: reason`).toBeGreaterThan(0);
        }
    });

    it.each(VOCABULARIES)('$entity: a roundTrip field resolves to its own header', (v: ExchangeVocabulary) => {
        for (const f of v.fields.filter((x) => x.disposition === 'roundTrip')) {
            // `pickColumn` takes the FIRST alias present, so the first alias
            // is the spelling an import resolves to — and the export has to
            // write that one or the two sides only agree by luck.
            expect(f.aliases[0], `${v.entity}.${f.header}`).toBe(f.header);
        }
    });

    it.each(VOCABULARIES)('$entity: an exportOnly field advertises no spelling', (v: ExchangeVocabulary) => {
        for (const f of v.fields.filter((x) => x.disposition === 'exportOnly')) {
            expect(f.aliases, `${v.entity}.${f.header}`).toEqual([]);
        }
    });

    it.each(VOCABULARIES)('POSITIVE CONTROL — $entity carries both dispositions', (v: ExchangeVocabulary) => {
        // Without this, an empty manifest — or one that is entirely
        // exportOnly — satisfies all three rules above.
        expect(v.fields.length).toBeGreaterThan(2);
        expect(v.fields.some((f) => f.disposition === 'roundTrip')).toBe(true);
        expect(v.fields.some((f) => f.disposition === 'exportOnly')).toBe(true);
    });
});

describe('exchange vocabulary — one alias dictionary', () => {
    it('is what the intake registry reads', () => {
        expect(CONTACT_HEADERS).toBe(INTAKE_HEADERS);
    });

    it('still spells today five fields exactly as it did', () => {
        expect(INTAKE_HEADERS.name).toEqual(['name', 'full name', 'fullname', 'contact', 'contact name']);
        expect(INTAKE_HEADERS.email).toEqual(['email', 'e-mail', 'email address']);
        expect(INTAKE_HEADERS.phone).toEqual(['phone', 'tel', 'mobile', 'phone number']);
        expect(INTAKE_HEADERS.agency).toEqual(['agency', 'company', 'organization', 'organisation', 'brokerage', 'firm']);
        expect(INTAKE_HEADERS.role).toEqual(['role', 'permission', 'access']);
    });

    it('refuses two manifests that spell the same field differently', () => {
        const a = { ...CONTACT_EXCHANGE };
        const b = {
            ...MEMBER_EXCHANGE,
            fields: MEMBER_EXCHANGE.fields.map((f) =>
                f.field === 'email' ? { ...f, aliases: ['email', 'inbox'] } : f),
        } as ExchangeVocabulary;
        expect(() => headerVocabulary(a, b)).toThrow(/email/);
    });

    it('POSITIVE CONTROL — the same call succeeds when they agree', () => {
        // Proves the throw above is about the conflict and not about the
        // merge refusing every input it is handed.
        expect(() => headerVocabulary(CONTACT_EXCHANGE, MEMBER_EXCHANGE)).not.toThrow();
    });
});

describe('data-exchange purity', () => {
    const DIR = resolve(__dirname, '../../../server/lib/data-exchange');
    const FORBIDDEN = ['drizzle-orm', 'hono', '/db/', '/services/', '/adapters/'];
    const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
    const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

    it('scans every file (an empty scan is a failure, not a pass)', () => {
        // eslint-disable-next-line no-console
        console.info(`data-exchange purity: scanned ${files.length} file(s): ${files.join(', ')}`);
        expect(files.length).toBeGreaterThanOrEqual(4);
    });

    it('imports nothing that would make it unusable from an adapter', () => {
        const violations: string[] = [];
        for (const file of files) {
            const source = readFileSync(join(DIR, file), 'utf8');
            IMPORT_RE.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = IMPORT_RE.exec(source)) !== null) {
                for (const fragment of FORBIDDEN) {
                    if (match[1].includes(fragment)) violations.push(`${file} imports "${match[1]}"`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('POSITIVE CONTROL — the rule would fire on a specifier that breaks it', () => {
        // The scan above reports health by finding nothing. This one proves the
        // regex and the fragment list can find something, over a line the real
        // files must never contain.
        const sample = `import { contacts } from '../db/schema';\n`;
        IMPORT_RE.lastIndex = 0;
        const match = IMPORT_RE.exec(sample);
        expect(match?.[1]).toBe('../db/schema');
        expect(FORBIDDEN.some((fragment) => (match?.[1] ?? '').includes(fragment))).toBe(true);
    });
});
