// The package compiles only the catalogue modules listed in
// `packages/field-ui/project.inlang/settings.json`. A message function the
// editor calls but that lives in an unlisted module simply does not exist in the
// package's compiled output: it is a type error on a good day and `undefined is
// not a function` in the field on a bad one. This test recomputes the closure
// from the sources and fails when the two disagree, in either direction.
//
// The scanned set is every package source that uses the package's `m`, plus the
// app files in `pending-move-set.json` that still have to move in and are still
// on `~/paraglide/messages`. Delete a path from that list in the commit that
// moves the file; the test fails on a path that no longer exists, so the list
// cannot silently go stale. The moved file is then found by the package scan.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import pending from './pending-move-set.json';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const PKG_SRC = join(REPO, 'packages/field-ui/src');
const SETTINGS = join(REPO, 'packages/field-ui/project.inlang/settings.json');

/** `m` imported from the app runtime or from the package's own i18n module. */
const IMPORTS_M =
    /import\s*\{[^}]*\bm\b[^}]*\}\s*from\s*['"](?:~\/paraglide\/messages|(?:\.{1,2}\/)+i18n(?:\/index)?|@core\/field-ui\/i18n)['"]/;
const M_KEY = /(?<![.\w])m\.([A-Za-z0-9_]+)/g;

function modulesFromSettings(settings: unknown): string[] {
    const patterns = (settings as Record<string, { pathPattern: string[] }>)['plugin.inlang.messageFormat'].pathPattern;
    return patterns.map((p) => {
        const match = /\/messages\/\{locale\}\/([^/]+)\.json$/.exec(p);
        if (!match) throw new Error(`pathPattern does not point at root messages/{locale}/<module>.json: ${p}`);
        return match[1];
    });
}

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === 'generated' || name === 'node_modules') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

/** Keys called through `m` by each file that imports it. */
function keysByFile(files: string[]): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (!IMPORTS_M.test(source)) continue;
        const keys = new Set<string>();
        for (const hit of source.matchAll(M_KEY)) keys.add(hit[1]);
        if (keys.size) out.set(relative(REPO, file).split(sep).join('/'), keys);
    }
    return out;
}

function catalogueOwners(): Map<string, string> {
    const owners = new Map<string, string>();
    const dir = join(REPO, 'messages/en');
    for (const name of readdirSync(dir)) {
        const catalogue = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, string>;
        for (const key of Object.keys(catalogue)) if (key !== '$schema') owners.set(key, name.replace(/\.json$/, ''));
    }
    return owners;
}

/** What is wrong with `modules` for the keys in `used`: missing keys and idle modules. */
function checkClosure(used: Map<string, Set<string>>, modules: string[]) {
    const owners = catalogueOwners();
    const unknown: string[] = [];
    const notIncluded: string[] = [];
    const needed = new Set<string>();
    for (const [file, keys] of used) {
        for (const key of keys) {
            const owner = owners.get(key);
            if (!owner) unknown.push(`${file}: m.${key} exists in no catalogue module`);
            else if (!modules.includes(owner)) notIncluded.push(`${file}: m.${key} is in '${owner}', which settings.json does not list`);
            else needed.add(owner);
        }
    }
    const idle = modules.filter((mod) => !needed.has(mod));
    return { unknown, notIncluded, idle, keyCount: new Set([...used.values()].flatMap((s) => [...s])).size };
}

function scannedFiles(): string[] {
    return [...walk(PKG_SRC), ...(pending as string[]).map((p) => join(REPO, p))];
}

describe('field-ui catalogue modules match the keys the editor uses', () => {
    const modules = modulesFromSettings(JSON.parse(readFileSync(SETTINGS, 'utf8')));

    it('every path in pending-move-set.json still exists', () => {
        const gone = (pending as string[]).filter((p) => !existsSync(join(REPO, p)));
        expect(gone, 'moved or deleted: remove these from pending-move-set.json').toEqual([]);
    });

    it('scans a plausible amount of code (an empty scan would pass vacuously)', () => {
        const used = keysByFile(scannedFiles());
        const { keyCount } = checkClosure(used, modules);
        console.info(`field-ui i18n closure: ${used.size} files use m, ${keyCount} distinct keys, ${modules.length} modules`);
        expect(used.size).toBeGreaterThan(80);
        expect(keyCount).toBeGreaterThan(700);
    });

    it('every used key lives in a listed module, and every listed module is used', () => {
        const result = checkClosure(keysByFile(scannedFiles()), modules);
        expect(result.unknown).toEqual([]);
        expect(result.notIncluded).toEqual([]);
        expect(result.idle, 'listed in settings.json but no scanned key lives there').toEqual([]);
    });

    it('can say no: dropping a module is reported', () => {
        const used = keysByFile(scannedFiles());
        const result = checkClosure(used, modules.filter((mod) => mod !== 'media'));
        expect(result.notIncluded.length).toBeGreaterThan(50);
        expect(result.notIncluded[0]).toContain("'media'");
    });
});
