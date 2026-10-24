/**
 * Layering: nothing under `server/` except the api layer itself may import
 * `server/api/**` or `server/index.ts`, statically or dynamically.
 *
 * Why it is pinned: tsc follows every import, including `import('...')`, so one stray
 * edge pulls the whole route tree (about 180 files and most of the type-checker's memory)
 * back into any program that only meant to include lib and services. The server
 * program can only be split into two projects while this holds.
 *
 * `ts.preProcessFile` is used instead of a regex so imports inside comments and strings
 * are not read, and `import type`, `export ... from` and dynamic imports are all seen.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../../..');
const SERVER = path.join(ROOT, 'server');

function listSources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) listSources(full, out);
        else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

const posix = (p: string): string => p.split(path.sep).join('/');

/** Files whose imports are checked: everything under server/ that is not the api layer or its entry. */
function isLowerLayer(file: string): boolean {
    const rel = posix(path.relative(SERVER, file));
    return !(rel.startsWith('api/') || rel === 'index.ts');
}

function reachesUp(fromFile: string, specifier: string): boolean {
    if (!specifier.startsWith('.')) return false;
    const target = posix(path.relative(SERVER, path.resolve(path.dirname(fromFile), specifier)));
    return target === 'api' || target.startsWith('api/') || target === 'index' || target === 'index.ts';
}

function violationsIn(file: string, source: string): string[] {
    const imported = ts.preProcessFile(source, true, true).importedFiles.map((i) => i.fileName);
    return imported.filter((spec) => reachesUp(file, spec));
}

describe('server layering', () => {
    it('flags an import of the api layer or the entry module, in every import form', () => {
        const f = path.join(SERVER, 'lib/x.ts');
        expect(violationsIn(f, "import { a } from '../api/sms';")).toEqual(['../api/sms']);
        expect(violationsIn(f, "import type { A } from '../api/sms';")).toEqual(['../api/sms']);
        expect(violationsIn(f, "export { a } from '../api/sms';")).toEqual(['../api/sms']);
        expect(violationsIn(f, "const m = await import('../index');")).toEqual(['../index']);
        expect(violationsIn(f, "const m = await import('../../server/index');")).toEqual(['../../server/index']);
    });

    it('does not flag lower-layer imports, comments or strings (positive controls)', () => {
        const f = path.join(SERVER, 'lib/x.ts');
        expect(violationsIn(f, "import { a } from './sms/delivery-status';\nimport { b } from '../services/people.service';")).toEqual([]);
        expect(violationsIn(f, "// import x from '../api/sms';\n/* import('../index') */\nconst s = \"from '../api/sms'\";")).toEqual([]);
        expect(violationsIn(f, "import { z } from 'zod';\nimport { c } from '~/lib/x';")).toEqual([]);
    });

    it('holds for every file below the api layer', () => {
        const files = listSources(SERVER).filter(isLowerLayer);
        const found: string[] = [];
        for (const file of files) {
            for (const spec of violationsIn(file, readFileSync(file, 'utf8'))) {
                found.push(`${posix(path.relative(ROOT, file))} -> ${spec}`);
            }
        }
        // Both numbers are asserted: zero violations from zero scanned files would be a broken walker.
        expect(files.length).toBeGreaterThan(900);
        expect(found).toEqual([]);
    });
});
