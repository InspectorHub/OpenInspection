/**
 * Runs the REAL `scripts/check-native-contract.mjs` against fixture registries and
 * documents, so the exit code and the printed numbers are what is under test --
 * not a re-implementation of them.
 *
 * Every failure case also asserts the two counts the gate prints, because a gate
 * that fails without saying how many it found cannot be told apart from one that
 * is broken.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const SCRIPT = join(REPO_ROOT, 'scripts/check-native-contract.mjs');

interface Entry { method: string; path: string }

let dir: string;
let counter = 0;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'native-contract-gate-'));
});
afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

function run(registry: Entry[], operations: Entry[]) {
    counter += 1;
    const registryFile = join(dir, `registry-${counter}.mjs`);
    const contractFile = join(dir, `contract-${counter}.json`);
    writeFileSync(
        registryFile,
        `export const NATIVE_CONTRACT = ${JSON.stringify(registry)};\nexport const NATIVE_NON_OPENAPI_CONTRACT = [];\n`,
    );
    const paths: Record<string, Record<string, object>> = {};
    for (const op of operations) (paths[op.path] ??= {})[op.method] = {};
    writeFileSync(contractFile, JSON.stringify({ openapi: '3.0.0', paths }));
    const result = spawnSync(process.execPath, [SCRIPT, '--registry', registryFile, '--contract', contractFile], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    });
    return { code: result.status, out: result.stdout, err: result.stderr };
}

const A: Entry = { method: 'get', path: '/api/a' };
const B: Entry = { method: 'post', path: '/api/b' };
const C: Entry = { method: 'get', path: '/api/c/{id}' };

describe('lint:native-contract', () => {
    it('passes when every registry entry is documented, printing both numbers', () => {
        const r = run([A, B], [A, B]);
        expect(r.code).toBe(0);
        expect(r.out).toContain('2 registry entries, 2 found in OpenAPI');
    });

    it('fails when NONE of the registry entries is documented, and still prints both numbers', () => {
        const r = run([A, B], []);
        expect(r.code).toBe(1);
        expect(r.out).toContain('2 registry entries, 0 found in OpenAPI');
        expect(r.err).toContain('documents none of the registry entries');
    });

    it('fails when fewer are found than registered, naming every missing entry', () => {
        const r = run([A, B, C], [A]);
        expect(r.code).toBe(1);
        expect(r.out).toContain('3 registry entries, 1 found in OpenAPI');
        expect(r.err).toContain('2 registry entries are not in');
        expect(r.err).toContain('post /api/b');
        expect(r.err).toContain('get /api/c/{id}');
        expect(r.err).not.toContain('documents none of the registry entries');
    });

    it('fails on an operation in the document that the registry does not list', () => {
        const r = run([A], [A, B]);
        expect(r.code).toBe(1);
        expect(r.out).toContain('1 registry entries, 1 found in OpenAPI');
        expect(r.err).toContain('1 operation(s)');
        expect(r.err).toContain('post /api/b');
    });

    it('fails on an empty registry instead of passing vacuously', () => {
        const r = run([], []);
        expect(r.code).toBe(1);
        expect(r.out).toContain('0 registry entries, 0 found in OpenAPI');
        expect(r.err).toContain('ZERO entries');
    });

    it('fails on duplicate registry entries', () => {
        const r = run([A, A], [A]);
        expect(r.code).toBe(1);
        expect(r.err).toContain('duplicate entries');
    });

    it('passes against the committed registry and contract (positive control)', () => {
        const result = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toMatch(/\d+ registry entries, \d+ found in OpenAPI/);
    });
});
