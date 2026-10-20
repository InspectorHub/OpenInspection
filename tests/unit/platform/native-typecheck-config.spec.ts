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
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { nativeSteps, validateNativeConfig } from '../../../scripts/type-check-native.mjs';

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

    it('a step list without the flag would be caught by the same assertion', () => {
        const args = ['-b', 'tsconfig.native-api.json'];
        expect(args.indexOf('--checkers')).toBe(-1);
    });
});

describe('native type-check packaging', () => {
    it('pins the preview package to an exact version', () => {
        const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
            devDependencies: Record<string, string>;
            scripts: Record<string, string>;
        };
        const v = pkg.devDependencies['@typescript/native-preview'];
        expect(v).toMatch(/^\d+\.\d+\.\d+-dev\.\d+\.\d+$/);
        expect(pkg.scripts['type-check:native']).toBe('node scripts/type-check-native.mjs');
        // The authoritative script must not have been rewired to the preview compiler.
        expect(pkg.scripts['type-check:api']).not.toMatch(/tsgo/);
    });

    it('rejects a ranged version by the same pattern', () => {
        expect('^7.0.0-dev.20260707.2').not.toMatch(/^\d+\.\d+\.\d+-dev\.\d+\.\d+$/);
    });

    it('ignores the native output directory in git', () => {
        const lines = readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
        expect(lines).toContain('.types-tsgo/');
        expect(lines).toContain('.types/');
    });
});
