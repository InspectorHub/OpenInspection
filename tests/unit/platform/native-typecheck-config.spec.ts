/**
 * The optional native type-check (`npm run type-check:native`) must stay out of the way of the
 * authoritative `tsc` projects.
 *
 * The two compilers must never share a build-info file or an output directory, or each run
 * invalidates the other's cache. This spec pins that on the four native tsconfigs, shows the
 * validator rejects a config that points back into `.types/`, and pins the single-checker flag and
 * the exact version pin on the preview package.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
// The directive must sit directly above the line carrying the module specifier, where tsc reports
// the missing declaration, so the import stays on one line.
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { nativeSteps, validateNativeConfig, isInsideNativeOutDir, stepsUseSingleChecker, isExactPinnedVersion, main } from '../../../scripts/type-check-native.mjs';

const ROOT = path.resolve(__dirname, '../../..');

interface NativeConfig {
    extends?: string;
    references?: { path: string }[];
    compilerOptions?: { outDir?: string; tsBuildInfoFile?: string };
}

function readJsonc(file: string): NativeConfig {
    const parsed = ts.parseConfigFileTextToJson(file, readFileSync(path.join(ROOT, file), 'utf8'));
    expect(parsed.error, `${file} must parse`).toBeUndefined();
    return parsed.config as NativeConfig;
}

const CASES = [
    { file: 'tsconfig.native-api.json', extends: './tsconfig.api.json', references: false },
    { file: 'tsconfig.native-app.json', extends: './tsconfig.json', references: true },
    { file: 'tsconfig.native-tests.json', extends: './tsconfig.tests.json', references: true },
    { file: 'tsconfig.native-e2e.json', extends: './tsconfig.playwright.json', references: true },
] as const;

describe('native type-check configs', () => {
    for (const c of CASES) {
        it(`${c.file} extends its original and writes only under .types-tsgo/`, () => {
            const cfg = readJsonc(c.file);
            expect(validateNativeConfig(cfg, { extends: c.extends, references: c.references })).toEqual([]);
            expect(cfg.extends).toBe(c.extends);
            expect(cfg.compilerOptions?.tsBuildInfoFile?.startsWith('./.types-tsgo/')).toBe(true);
            if (cfg.compilerOptions?.outDir !== undefined) {
                expect(cfg.compilerOptions.outDir.startsWith('./.types-tsgo')).toBe(true);
            }
            // Negative with its positive control above: nothing may land in the tsc-owned directory.
            expect(JSON.stringify(cfg)).not.toMatch(/\.types\//);
        });
    }

    it('the consuming programs reference the native API project, not the tsc one', () => {
        for (const c of CASES.filter((x) => x.references)) {
            const refs = (readJsonc(c.file).references ?? []).map((r) => r.path);
            expect(refs, c.file).toEqual(['./tsconfig.native-api.json']);
            expect(refs, c.file).not.toContain('./tsconfig.api.json');
        }
    });

    it('the validator rejects a build-info file that points into .types/', () => {
        const bad = {
            extends: './tsconfig.api.json',
            compilerOptions: { outDir: './.types-tsgo', tsBuildInfoFile: './.types/.tsbuildinfo.api' },
        };
        const problems = validateNativeConfig(bad, { extends: './tsconfig.api.json', references: false });
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.join('\n')).toMatch(/tsBuildInfoFile/);
    });

    it('the validator rejects an outDir in .types/ and a reference to the tsc API project', () => {
        const bad = {
            extends: './tsconfig.json',
            references: [{ path: './tsconfig.api.json' }],
            compilerOptions: { outDir: './.types', tsBuildInfoFile: './.types-tsgo/.tsbuildinfo.app' },
        };
        const problems = validateNativeConfig(bad, { extends: './tsconfig.json', references: true }).join('\n');
        expect(problems).toMatch(/outDir/);
        expect(problems).toMatch(/references/);
    });
});

describe('native type-check steps', () => {
    it('runs api first, then app, tests, e2e, each with a single checker', () => {
        const steps = nativeSteps() as { name: string; config: string; args: string[] }[];
        expect(steps.map((s) => s.name)).toEqual(['api', 'app', 'tests', 'e2e']);
        for (const s of steps) {
            const i = s.args.indexOf('--checkers');
            expect(i, s.name).toBeGreaterThanOrEqual(0);
            expect(s.args[i + 1], s.name).toBe('1');
            expect(s.args[0]).toBe('-b');
            expect(s.args[1]).toBe(s.config);
        }
    });

    it('the single-checker check accepts the real steps and rejects one without the flag', () => {
        expect(stepsUseSingleChecker(nativeSteps())).toBe(true);
        const real = nativeSteps() as { name: string; config: string; args: string[] }[];
        const missing = real.map((s, i) => (i === 0 ? { ...s, args: ['-b', s.config] } : s));
        expect(stepsUseSingleChecker(missing)).toBe(false);
        const wrong = real.map((s) => ({ ...s, args: ['-b', s.config, '--checkers', '4'] }));
        expect(stepsUseSingleChecker(wrong)).toBe(false);
    });
});

describe('native output directory containment', () => {
    it('accepts paths that stay inside .types-tsgo/', () => {
        expect(isInsideNativeOutDir('./.types-tsgo/.tsbuildinfo.api')).toBe(true);
        expect(isInsideNativeOutDir('./.types-tsgo')).toBe(true);
        expect(isInsideNativeOutDir('.types-tsgo/server/')).toBe(true);
        expect(isInsideNativeOutDir('./.types-tsgo/a/../b')).toBe(true);
    });

    it('rejects traversal out of .types-tsgo/ and look-alike names', () => {
        expect(isInsideNativeOutDir('./.types-tsgo/../.types/x')).toBe(false);
        expect(isInsideNativeOutDir('.types-tsgo/../.types/.tsbuildinfo.api')).toBe(false);
        expect(isInsideNativeOutDir('../.types-tsgo/x')).toBe(false);
        expect(isInsideNativeOutDir('./.types-tsgo-old/x')).toBe(false);
        expect(isInsideNativeOutDir('./.types/x')).toBe(false);
    });

    it('the validator rejects a traversal into .types/ in either field and accepts the normal form', () => {
        const expected = { extends: './tsconfig.api.json', references: false };
        const good = {
            extends: './tsconfig.api.json',
            compilerOptions: { outDir: './.types-tsgo', tsBuildInfoFile: './.types-tsgo/.tsbuildinfo.api' },
        };
        expect(validateNativeConfig(good, expected)).toEqual([]);
        const sneaky = {
            extends: './tsconfig.api.json',
            compilerOptions: {
                outDir: './.types-tsgo/../.types',
                tsBuildInfoFile: './.types-tsgo/../.types/.tsbuildinfo.api',
            },
        };
        const problems = validateNativeConfig(sneaky, expected).join('\n');
        expect(problems).toMatch(/outDir/);
        expect(problems).toMatch(/tsBuildInfoFile/);
    });
});

describe('native type-check runner control flow', () => {
    const quiet = { log: () => undefined, error: () => undefined };

    it('runs every step in order and returns 0 when all succeed', () => {
        const seen: string[] = [];
        const code = main({
            root: ROOT,
            resolveLauncher: () => '/fake/tsgo',
            spawn: (_node: string, args: string[]) => {
                seen.push(args[2]);
                return { status: 0 };
            },
            ...quiet,
        });
        expect(code).toBe(0);
        expect(seen).toEqual([
            'tsconfig.native-api.json',
            'tsconfig.native-app.json',
            'tsconfig.native-tests.json',
            'tsconfig.native-e2e.json',
        ]);
    });

    it('stops at the first failing step and returns its exit code', () => {
        const seen: string[] = [];
        const errors: string[] = [];
        const code = main({
            root: ROOT,
            resolveLauncher: () => '/fake/tsgo',
            spawn: (_node: string, args: string[]) => {
                seen.push(args[2]);
                return { status: args[2] === 'tsconfig.native-app.json' ? 2 : 0 };
            },
            log: () => undefined,
            error: (m: string) => errors.push(m),
        });
        expect(code).toBe(2);
        expect(seen).toEqual(['tsconfig.native-api.json', 'tsconfig.native-app.json']);
        expect(errors.join('\n')).toMatch(/app: FAILED with exit code 2/);
    });

    it('treats a process with no exit status as a failure', () => {
        const code = main({
            root: ROOT,
            resolveLauncher: () => '/fake/tsgo',
            spawn: () => ({ status: null }),
            ...quiet,
        });
        expect(code).toBe(1);
    });

    it('returns 1 with an install hint when the package is missing, and runs nothing', () => {
        const errors: string[] = [];
        let spawned = 0;
        const code = main({
            root: ROOT,
            resolveLauncher: () => null,
            spawn: () => {
                spawned += 1;
                return { status: 0 };
            },
            log: () => undefined,
            error: (m: string) => errors.push(m),
        });
        expect(code).toBe(1);
        expect(spawned).toBe(0);
        expect(errors.join('\n')).toMatch(/npm install/);
    });
});

describe('native type-check packaging', () => {
    it('pins the preview package to an exact version', () => {
        const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
            devDependencies: Record<string, string>;
            scripts: Record<string, string>;
        };
        const v = pkg.devDependencies['@typescript/native-preview'];
        expect(isExactPinnedVersion(v)).toBe(true);
        expect(pkg.scripts['type-check:native']).toBe('node scripts/type-check-native.mjs');
        // The authoritative script must not have been rewired to the preview compiler.
        expect(pkg.scripts['type-check:api']).not.toMatch(/tsgo/);
    });

    it('the exact-pin check accepts an exact version and rejects ranged ones', () => {
        expect(isExactPinnedVersion('7.0.0-dev.20260707.2')).toBe(true);
        expect(isExactPinnedVersion('^7.0.0-dev.20260707.2')).toBe(false);
        expect(isExactPinnedVersion('~7.0.0-dev.20260707.2')).toBe(false);
        expect(isExactPinnedVersion('latest')).toBe(false);
    });

    it('ignores the native output directory in git', () => {
        const lines = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
        expect(lines).toContain('.types-tsgo/');
        expect(lines).toContain('.types/');
    });
});

describe('generated-directory skip lists cover .types-tsgo', () => {
    const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
    const hasEntry = (src: string, name: string) => src.includes(`'${name}'`) || src.includes(`"${name}"`);
    const SCRIPTS = [
        'scripts/check-english-only.mjs',
        'scripts/check-extension-collisions.mjs',
        'scripts/check-ai-classification.mjs',
        'scripts/check-test-imports.mjs',
        'scripts/check-submit-guard.mjs',
        'scripts/check-zero-tracking.mjs',
        'scripts/check-view-tracking-invariants.mjs',
        'scripts/check-no-private-review-refs.mjs',
    ];

    for (const f of SCRIPTS) {
        it(`${f} skips both .types and .types-tsgo`, () => {
            const src = read(f);
            // Positive control: the check finds the long-standing entry, so a miss below is real.
            expect(hasEntry(src, '.types'), `${f} control`).toBe(true);
            expect(hasEntry(src, '.types-tsgo'), f).toBe(true);
        });
    }

    it('eslint ignores .types-tsgo/** as well as .types/**', () => {
        const src = read('eslint.config.js');
        expect(src).toContain("'.types/**'");
        expect(src).toContain("'.types-tsgo/**'");
    });

    it('the entry check tells a present name from an absent one', () => {
        expect(hasEntry("new Set(['node_modules', '.types'])", '.types-tsgo')).toBe(false);
        expect(hasEntry("new Set(['node_modules', '.types', '.types-tsgo'])", '.types-tsgo')).toBe(true);
    });
});
