/**
 * Every signing-key service is built through its factory, and the callers that hand secrets down hand the earlier ones too. A caller that
 * builds the service with only the current secret works until a rotation and then fails (a portal amendment lands in the dead-letter queue).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
        return /\.ts$/.test(name) ? [full] : [];
    });
}

const files = [...sourceFiles(join(ROOT, 'server')), ...sourceFiles(join(ROOT, 'workers'))]
    .map((file) => ({ rel: relative(ROOT, file).split('\\').join('/'), text: readFileSync(file, 'utf8') }));

/** The text of each call that starts with `opener`, up to its statement end. */
function calls(opener: RegExp): Array<{ rel: string; call: string }> {
    return files.flatMap(({ rel, text }) => [...text.matchAll(opener)]
        .filter((m) => !text.slice(Math.max(0, m.index! - 9), m.index!).endsWith('function '))
        .map((m) => ({ rel, call: text.slice(m.index!, text.indexOf(';', m.index!)) })));
}

describe('how the signing-key service is built', () => {
    it('scans a real set of files (control)', () => {
        expect(files.length).toBeGreaterThan(300);
        expect(calls(/SigningKeyService\.fromEnv\(/g).length).toBeGreaterThan(3);
    });

    it('nothing outside the service itself calls its constructor', () => {
        const direct = calls(/new SigningKeyService\(/g).filter((c) => c.rel !== 'server/services/signing-key.service.ts');
        expect(direct.map((c) => c.rel)).toEqual([]);
    });

    it('every place that builds a service which signs passes the earlier secrets as well', () => {
        const builders = calls(/new (InspectionService|ReportVersionService|ComplianceService)\(/g);
        expect(builders.length).toBeGreaterThan(3);
        expect(builders.filter((c) => !/previous|signingKeySecrets/i.test(c.call)).map((c) => c.rel)).toEqual([]);
    });

    it('every caller of the command and correction chain passes them down', () => {
        const chain = calls(/\b(handleCmdBatch|applyReportCorrection|correctReport)\(/g)
            ;
        expect(chain.length).toBeGreaterThan(1);
        expect(chain.filter((c) => !/previous|signingKeySecrets/i.test(c.call)).map((c) => c.rel)).toEqual([]);
    });
});
