/**
 * The per-request memo primitive behind the in-process API fan-out.
 *
 * Two properties carry the whole design and neither is obvious from the call
 * shape: the memo caches the PROMISE rather than the value (the fan-out is
 * parallel, so a value cache would let every concurrent caller miss and
 * recompute — correct-looking code that saves nothing), and `memoOnce` falls
 * through to the factory when no scope is present, which is what keeps
 * external HTTP requests on unchanged per-request verification.
 */
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { capsOverridesKey, CREDENTIAL_KEY, createCredentialScope, createRequestScope, memoOnce, REQUEST_SCOPE } from '../../../server/lib/request-scope';

describe('RequestScope', () => {
    it('runs the factory once per key', async () => {
        const scope = createRequestScope();
        const fn = vi.fn(async () => 'v');
        expect(await scope.once('k', fn)).toBe('v');
        expect(await scope.once('k', fn)).toBe('v');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('shares the IN-FLIGHT promise with concurrent callers', async () => {
        // The 15 loader calls are issued in parallel. A value cache would let
        // all 15 miss and all 15 compute; only a promise cache dedupes them.
        const scope = createRequestScope();
        let resolve!: (v: string) => void;
        const fn = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
        const both = Promise.all([scope.once('k', fn), scope.once('k', fn)]);
        resolve('v');
        expect(await both).toEqual(['v', 'v']);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('propagates rejection to every waiter and does not swallow it', async () => {
        const scope = createRequestScope();
        const fn = vi.fn(async () => { throw new Error('boom'); });
        await expect(scope.once('k', fn)).rejects.toThrow('boom');
        await expect(scope.once('k', fn)).rejects.toThrow('boom');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('keeps two scopes independent', async () => {
        const a = createRequestScope();
        const b = createRequestScope();
        const fn = vi.fn(async () => 'v');
        await a.once('k', fn);
        await b.once('k', fn);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

describe('memoOnce', () => {
    it('memoises when the env carries a scope', async () => {
        const env = { [REQUEST_SCOPE]: createRequestScope() };
        const fn = vi.fn(async () => 1);
        await memoOnce(env, 'k', fn);
        await memoOnce(env, 'k', fn);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    // POSITIVE CONTROL for every "does not re-run" assertion in later tasks:
    // without a scope the factory MUST still run every time. Without this,
    // a memoOnce that silently returned undefined would pass the tests above.
    it('runs every time when the env carries no scope', async () => {
        const fn = vi.fn(async () => 1);
        expect(await memoOnce({}, 'k', fn)).toBe(1);
        expect(await memoOnce({}, 'k', fn)).toBe(1);
        expect(await memoOnce(undefined, 'k', fn)).toBe(1);
        expect(fn).toHaveBeenCalledTimes(3);
    });
});

describe('createCredentialScope', () => {
    it('shares native-token, credential-change and permission-override lookups, and only those', async () => {
        const env = { [REQUEST_SCOPE]: createCredentialScope() };
        const shared = vi.fn(async () => 'who');
        const marker = vi.fn(async () => 'ts');
        await memoOnce(env, 'native:u:g:s', shared);
        await memoOnce(env, 'native:u:g:s', shared);
        await memoOnce(env, 'pwchanged:u1', marker);
        await memoOnce(env, 'pwchanged:u1', marker);
        expect(shared).toHaveBeenCalledTimes(1);
        expect(marker).toHaveBeenCalledTimes(1);
        const overrides = vi.fn(async () => 'caps');
        await memoOnce(env, 'caps-overrides:t1:u1', overrides);
        await memoOnce(env, 'caps-overrides:t1:u1', overrides);
        expect(overrides).toHaveBeenCalledTimes(1);

        // Isolation: the key the middleware builds names the company and the user, so a different user or company never shares an entry.
        const keys = [capsOverridesKey('t5', 'u5'), capsOverridesKey('t5', 'u6'), capsOverridesKey('t6', 'u5')];
        expect(new Set(keys).size).toBe(3);
        for (const key of keys) expect(key, key).toMatch(CREDENTIAL_KEY);
        const factories = keys.map((key) => vi.fn(async () => key));
        for (let i = 0; i < 2; i += 1) {
            for (const [n, key] of keys.entries()) expect(await memoOnce(env, key, factories[n]!)).toBe(key);
        }
        for (const fn of factories) expect(fn).toHaveBeenCalledTimes(1);

        // Control: anything else runs every time, so a replay never reads another replay's write.
        const other = vi.fn(async () => 'cfg');
        await memoOnce(env, 'tenant-config:all:t1', other);
        await memoOnce(env, 'tenant-config:all:t1', other);
        expect(other).toHaveBeenCalledTimes(2);
    });
});

/**
 * The credential scope shares a user's permission overrides across the replays of an offline import, on the stated ground that none
 * of the replayed writes (inspection create, update and complete) changes a user. The proof of that is the runtime test in
 * tests/unit/native/offline-import-no-user-writes.spec.ts, which replays the three commands and inspects every statement. The scan
 * below is a cheap complement: it reads only the route and service sources under the two directories named, so it catches a direct
 * write placed there and says nothing about a helper elsewhere in the call tree.
 */
describe('the credential scope and permission overrides', () => {
    const roots = ['server/api/inspections', 'server/services/inspection'];

    function sources(dir: string): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) return sources(path);
            return /\.ts$/.test(entry.name) ? [path] : [];
        });
    }
    const WRITES_OVERRIDES = /permissionOverrides|permission_overrides|update\(\s*(?:schema\.)?users\s*\)/;
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('is not contradicted by any code the replayed inspection routes run', () => {
        const files = roots.flatMap((root) => sources(join(process.cwd(), root)));
        console.log(`[credential-scope] scanned ${files.length} file(s) under ${roots.join(', ')}`);
        expect(files.length).toBeGreaterThan(20);
        const offenders = files.filter((file) => WRITES_OVERRIDES.test(code(readFileSync(file, 'utf8')))).map((file) => relative(process.cwd(), file));
        expect(offenders).toEqual([]);
    });

    it('is not blind: the scan flags a write to the overrides and ignores a mention in a comment', () => {
        expect(WRITES_OVERRIDES.test(code('await db.update(users).set({ permissionOverrides: {} })'))).toBe(true);
        expect(WRITES_OVERRIDES.test(code('// permissionOverrides are read elsewhere\nconst a = 1;'))).toBe(false);
        expect(WRITES_OVERRIDES.test(code('/* permission_overrides */ const a = 1;'))).toBe(false);
    });
});
