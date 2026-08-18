/**
 * The adapter layer's one architectural rule, made executable.
 *
 * An adapter is a pure function from a vendor's export to the normalised
 * format. It must not reach the database, the request context, or the ORM —
 * that boundary is the reason reverse-engineering a new vendor's file does not
 * require understanding how anything is written, and the reason a vendor
 * changing their format cannot affect write correctness.
 *
 * The check reads the direct import specifiers of every file in the adapter
 * directory. It is a DIRECT-import check, not a transitive one: it catches the
 * way this rule actually gets broken (someone reaches for a table because it
 * was convenient) and does not pretend to prove purity.
 *
 * The scanned-file count is asserted and printed. A gate that silently scans
 * nothing reports success on the day the directory is renamed.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ADAPTER_DIR = resolve(__dirname, '../../../server/lib/migration-intake/adapters');

/** Specifier fragments an adapter may not import. */
const FORBIDDEN = [
    { fragment: 'drizzle-orm', why: 'an adapter does not query' },
    { fragment: 'hono', why: 'an adapter has no request' },
    { fragment: '/db/', why: 'an adapter does not know the storage layer exists' },
    { fragment: '/services/', why: 'an adapter does not call the write path' },
];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importSpecifiers(source: string): string[] {
    const out: string[] = [];
    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source)) !== null) out.push(match[1]);
    return out;
}

describe('adapter layer purity', () => {
    const files = readdirSync(ADAPTER_DIR).filter((f) => f.endsWith('.ts'));

    it('scans every adapter file (an empty scan is a failure, not a pass)', () => {
        // eslint-disable-next-line no-console
        console.info(`adapter-purity: scanned ${files.length} file(s): ${files.join(', ')}`);
        expect(files.length).toBeGreaterThanOrEqual(2);
    });

    it('imports nothing from the storage, request or service layers', () => {
        const violations: string[] = [];
        for (const file of files) {
            const source = readFileSync(join(ADAPTER_DIR, file), 'utf8');
            for (const spec of importSpecifiers(source)) {
                for (const rule of FORBIDDEN) {
                    if (spec.includes(rule.fragment)) {
                        violations.push(`${file} imports "${spec}" — ${rule.why}`);
                    }
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('positive control: the rule would fire on a specifier that breaks it', () => {
        const sample = `import { contacts } from '../../db/schema';\n`;
        const hits = importSpecifiers(sample)
            .filter((spec) => FORBIDDEN.some((r) => spec.includes(r.fragment)));
        expect(hits).toEqual(['../../db/schema']);
    });
});
