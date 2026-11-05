/**
 * The upstream watch for the minimatch advisory (scripts/check-minimatch-upstream.mjs) and the facts about package.json that
 * docs/develop/dependency-policy.md relies on.
 *
 * The watch exits 10 (READY) or 11 (DONE) ONLY when every holder's latest release admits a patched minimatch (or none remains), so the cases below pin both directions
 * (a range that admits, one that does not) and the failure mode that matters most: a fetch that fails is never counted as admitting.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface Result { status: 'ok' | 'error'; admits?: boolean; range?: string | null }
interface Summary { holders: number; admits: number; unknown: number; ready: boolean; done: boolean }
interface Mod {
    admitsPatched: (range: unknown) => boolean;
    rangeAdmits: (range: string, version: string) => boolean;
    isBelowPatched: (version: string) => boolean;
    holdersOf: (lock: unknown) => Array<{ name: string; installed: string; minimatch: string }>;
    summarize: (results: Result[]) => Summary;
    watch: (lock: unknown, fetchImpl: (url: string) => Promise<unknown>) => Promise<{ results: Array<Result & { name: string }>; summary: Summary }>;
}
let m: Mod;
const ROOT = process.cwd();

beforeAll(async () => {
    const url = pathToFileURL(path.join(ROOT, 'scripts/check-minimatch-upstream.mjs')).href;
    // @vite-ignore - load the .mjs natively; vitest's transform cannot process it.
    m = await import(/* @vite-ignore */ url) as Mod;
});

const LOCK = {
    packages: {
        '': { name: 'root' },
        'node_modules/minimatch': { version: '10.2.4' },
        'node_modules/tool-a': { version: '1.0.0', dependencies: { minimatch: '^10.2.4' } },
        'node_modules/tool-b': { version: '2.0.0', dependencies: { minimatch: '^3.1.2' } },
        'node_modules/tool-b/node_modules/minimatch': { version: '3.1.5' },
        'node_modules/tool-c': { version: '3.0.0', dependencies: { minimatch: '^11.0.1' } },
        'node_modules/tool-c/node_modules/minimatch': { version: '11.0.4' },
        'node_modules/tool-d': { version: '4.0.0', dependencies: { other: '^1' } },
        'node_modules/@scope/tool-e': { version: '5.0.0', dependencies: { minimatch: '^10.0.0' } },
    },
};

const registry = (table: Record<string, string | null | 'fail'>) => async (url: string) => {
    const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', '').replace(/\/latest$/, ''));
    const range = table[name];
    if (range === 'fail' || range === undefined) throw new Error('network down');
    return { ok: true, json: async () => ({ version: '9.9.9', dependencies: range === null ? {} : { minimatch: range } }) };
};

describe('range logic', () => {
    it('admits a range that reaches a patched line, and not one that stays below it', () => {
        for (const range of ['^11.0.1', '^11.0.0', '>=10.2.4', '11.x', '*', '^9.0.3 || ^11.0.2', '>=11']) expect(m.admitsPatched(range), range).toBe(true);
        for (const range of ['^11.0.0-beta.1', '10.0.0 - 11.5.0', '>=11.0.0-rc.1']) expect(m.admitsPatched(range), range).toBe(true);
        for (const range of ['^10.0.0-beta.1', '1.0.0 - 2.0.0', 'workspace:*', 'file:../x', 'github:a/b', '^', '>=']) expect(m.admitsPatched(range), range).toBe(false);
        for (const range of ['^10.2.4', '^3.1.2', '~10.2.0', '^9.0.3 || ^10.1.2', '<11', '10.2.6', '>=9 <11', undefined, null, '', 'not a range']) expect(m.admitsPatched(range), String(range)).toBe(false);
    });

    it('answers single versions the way semver does for the shapes in use', () => {
        expect(m.rangeAdmits('^10.2.4', '10.9.0')).toBe(true);
        expect(m.rangeAdmits('^10.2.4', '11.0.1')).toBe(false);
        expect(m.rangeAdmits('~3.1.2', '3.1.9')).toBe(true);
        expect(m.rangeAdmits('~3.1.2', '3.2.0')).toBe(false);
        expect(m.rangeAdmits('^0.2.1', '0.2.9')).toBe(true);
        expect(m.rangeAdmits('^0.2.1', '0.3.0')).toBe(false);
    });

    it('calls a minimatch older than 11.0.1 below the patched release and a later one not', () => {
        expect(m.isBelowPatched('10.2.6')).toBe(true);
        expect(m.isBelowPatched('11.0.0')).toBe(true);
        expect(m.isBelowPatched('11.0.1')).toBe(false);
        expect(m.isBelowPatched('11.0.4')).toBe(false);
    });
});

describe('holders in the lockfile', () => {
    it('lists the packages that depend on a minimatch older than 11.0.1, resolved the way node resolves it', () => {
        const holders = m.holdersOf(LOCK).map((h) => `${h.name}@${h.minimatch}`);
        expect(holders).toEqual(['@scope/tool-e@10.2.4', 'tool-a@10.2.4', 'tool-b@3.1.5']);
        // Controls: a holder on a patched copy and a package with no minimatch dependency are not listed.
        expect(holders.join(' ')).not.toContain('tool-c');
        expect(holders.join(' ')).not.toContain('tool-d');
    });
});

describe('the watch', () => {
    it('is ready only when every holder admits a patched minimatch; prints both numbers', async () => {
        const all = await m.watch(LOCK, registry({ 'tool-a': '^11.0.1', 'tool-b': '^11.0.1', '@scope/tool-e': '^10.0.0 || ^11.0.2' }));
        console.log(`[watch] holders=${all.summary.holders} admits=${all.summary.admits} unknown=${all.summary.unknown}`);
        expect(all.summary).toEqual({ holders: 3, admits: 3, unknown: 0, ready: true, done: false });
        // Negative control: one holder that still stops at 10 keeps it not ready.
        const some = await m.watch(LOCK, registry({ 'tool-a': '^11.0.1', 'tool-b': '^3.1.2', '@scope/tool-e': '^11.0.1' }));
        expect(some.summary).toEqual({ holders: 3, admits: 2, unknown: 0, ready: false, done: false });
    });

    it('never counts a failed fetch as admitting: it is unknown and the result is not ready', async () => {
        const result = await m.watch(LOCK, registry({ 'tool-a': '^11.0.1', 'tool-b': 'fail', '@scope/tool-e': '^11.0.1' }));
        expect(result.results.find((r) => r.name === 'tool-b')?.status).toBe('error');
        expect(result.summary).toEqual({ holders: 3, admits: 2, unknown: 1, ready: false, done: false });
        // A registry answer with an error status fails the same way.
        const notOk = await m.watch(LOCK, async () => ({ ok: false, json: async () => ({}) }));
        expect(notOk.summary).toEqual({ holders: 3, admits: 0, unknown: 3, ready: false, done: false });
    });

    it('treats a registry answer that is not the package metadata as UNKNOWN, never as "no longer depends on minimatch"', async () => {
        const answering = (body: unknown) => async () => ({ ok: true, json: async () => body });
        for (const body of [{}, [], null, 'text', { dependencies: {} }, { name: 'some-other-package', version: '1.0.0' }]) {
            const result = await m.watch(LOCK, answering(body));
            expect(result.summary, JSON.stringify(body)).toEqual({ holders: 3, admits: 0, unknown: 3, ready: false, done: false });
        }
        // Control: real metadata that really dropped minimatch does count (version present, no minimatch range).
        const dropped = await m.watch(LOCK, answering({ version: '9.9.9', dependencies: {} }));
        expect(dropped.summary.ready).toBe(true);
    });

    it('is not "ready" when there is nothing to watch, but says it is done, so an empty lockfile is told apart from success', () => {
        expect(m.summarize([])).toEqual({ holders: 0, admits: 0, unknown: 0, ready: false, done: true });
    });

    it('counts a latest release that no longer depends on minimatch as admitting, and says "(dropped)" in the table', async () => {
        const result = await m.watch(LOCK, registry({ 'tool-a': null, 'tool-b': '^11.0.1', '@scope/tool-e': '^11.0.1' }));
        expect(result.results.find((r) => r.name === 'tool-a')).toMatchObject({ status: 'ok', admits: true, range: null });
        expect(result.summary.ready).toBe(true);
        // Control: a release that does declare an older range still does not admit.
        const kept = await m.watch(LOCK, registry({ 'tool-a': '^10.2.4', 'tool-b': '^11.0.1', '@scope/tool-e': '^11.0.1' }));
        expect(kept.summary.ready).toBe(false);
    });
});

describe('package.json facts the dependency policy relies on', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { overrides: Record<string, unknown> };

    it('has no global minimatch or glob override: the eslint toolchain keeps its own copies (docs/develop/dependency-policy.md)', () => {
        expect(Object.keys(pkg.overrides)).not.toContain('minimatch');
        expect(Object.keys(pkg.overrides)).not.toContain('glob');
    });

    it('moves only the exceljs chain: archiver-utils and readdir-glob by package name, and unzipper', () => {
        expect(pkg.overrides['archiver-utils']).toEqual({ glob: '^14.0.3' });
        expect(pkg.overrides['readdir-glob']).toEqual({ minimatch: '^11.0.1' });
        expect(pkg.overrides['unzipper']).toBe('^0.12.5');
    });
});

describe('the command line', () => {
    const script = path.join(ROOT, 'scripts/check-minimatch-upstream.mjs');
    const run = (args: string[]): { code: number; out: string } => {
        try {
            return { code: 0, out: execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
        } catch (err) {
            const e = err as { status: number; stdout: string; stderr: string };
            return { code: e.status, out: `${e.stdout}${e.stderr}` };
        }
    };

    it('exits 2, not a signal code, when the watch itself fails: an unreadable lockfile', () => {
        const result = run(['--lock', path.join(tmpdir(), 'no-such-lockfile-for-the-watch.json')]);
        expect(result.code).toBe(2);
        expect(result.out).toContain('ERROR');
        expect(result.out).not.toContain('READY');
        // A raw crash of the runtime exits 1, which is neither signal: the signals are 10 and 11.
        expect([result.code]).not.toContain(10);
        expect([result.code]).not.toContain(11);
    }, 30_000);

    it('exits 11 with the "done" message when no package depends on a minimatch older than 11.0.1, and says so rather than "not ready"', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'minimatch-watch-'));
        try {
            const file = path.join(dir, 'lock.json');
            writeFileSync(file, JSON.stringify({ packages: { '': {}, 'node_modules/minimatch': { version: '11.0.4' }, 'node_modules/x': { version: '1.0.0', dependencies: { minimatch: '^11.0.1' } } } }));
            const result = run(['--lock', file]);
            expect(result.code).toBe(11);
            expect(result.out).toContain('DONE');
            expect(result.out).not.toContain('not ready');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    }, 30_000);
});

describe('the lockfile outcome of the exceljs chain', () => {
    type Entry = { version?: string; dev?: boolean };
    const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, Entry> };
    const major = (v?: string): number => Number(String(v).split('.')[0]);
    const atLeast = (v: string | undefined, min: [number, number, number]): boolean => {
        const p = String(v).split('.').map(Number);
        return p[0]! > min[0] || (p[0] === min[0] && (p[1]! > min[1] || (p[1] === min[1] && p[2]! >= min[2])));
    };
    /** Installed entries of one package name, wherever they sit in the tree, split by whether they are development-only. */
    const entriesOf = (name: string) => Object.entries(lock.packages).filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
    const production = (name: string) => entriesOf(name).filter(([, info]) => info.dev !== true);

    it('every minimatch copy installed with the production dependencies is 11.0.1 or later (development-only copies are the documented remainder)', () => {
        const prod = production('minimatch');
        const dev = entriesOf('minimatch').filter(([, info]) => info.dev === true);
        console.log(`[lockfile] minimatch copies: ${prod.length} production, ${dev.length} development-only`);
        expect(prod.length).toBeGreaterThan(0);
        for (const [key, info] of prod) expect(atLeast(info.version, [11, 0, 1]), `${key}: ${info.version}`).toBe(true);
        // Control: the filter is real, because the development-only copies are the older ones the policy lists.
        expect(dev.length).toBeGreaterThan(0);
        expect(dev.some(([, info]) => !atLeast(info.version, [11, 0, 1]))).toBe(true);
    });

    it('every glob copy installed with the production dependencies is 14 or later, and unzipper is 0.12.5 or later', () => {
        const globs = production('glob');
        expect(globs.length).toBeGreaterThan(0);
        for (const [key, info] of globs) expect(major(info.version), key).toBeGreaterThanOrEqual(14);
        expect(atLeast(lock.packages['node_modules/unzipper']?.version, [0, 12, 5])).toBe(true);
    });

    it('has no fstream or rimraf among the production dependencies', () => {
        expect(production('fstream')).toEqual([]);
        expect(production('rimraf')).toEqual([]);
    });
});
