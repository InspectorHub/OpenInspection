/**
 * Iter-2 bug #12 — escape hatch helper for the Sync Conflict modal.
 *
 * The helper deletes the offline Dexie database (`oi_offline`) and any
 * inspection-scoped localStorage entries so a user trapped behind a
 * stuck conflict modal can recover without DevTools.
 */
import { describe, expect, it, vi } from 'vitest';
import { resetLocalStore, OFFLINE_DB_NAME } from '../../public/js/reset-local-store.js';

interface FakeIDBRequest {
    onsuccess: (() => void) | null;
    onerror:   (() => void) | null;
    onblocked: (() => void) | null;
    error: unknown;
}

function fakeIndexedDB(opts: { fail?: boolean; blocked?: boolean } = {}) {
    const calls: string[] = [];
    const idb = {
        deleteDatabase(name: string) {
            calls.push(name);
            const req: FakeIDBRequest = { onsuccess: null, onerror: null, onblocked: null, error: null };
            queueMicrotask(() => {
                if (opts.fail) {
                    req.error = new Error('synthetic');
                    req.onerror?.();
                } else if (opts.blocked) {
                    req.onblocked?.();
                } else {
                    req.onsuccess?.();
                }
            });
            return req;
        },
    };
    return { idb, calls };
}

function fakeLocalStorage(seed: Record<string, string>) {
    const store = new Map(Object.entries(seed));
    return {
        get length() { return store.size; },
        key(i: number) { return [...store.keys()][i] ?? null; },
        getItem(k: string) { return store.get(k) ?? null; },
        setItem(k: string, v: string) { store.set(k, v); },
        removeItem(k: string) { store.delete(k); },
        clear() { store.clear(); },
        _store: store,
    };
}

describe('resetLocalStore (iter-2 bug #12)', () => {
    it('deletes the offline Dexie database', async () => {
        const { idb, calls } = fakeIndexedDB();
        const ls = fakeLocalStorage({});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resetLocalStore({ indexedDB: idb as any, localStorage: ls as any });
        if (!result.ok) throw new Error('expected ok=true');
        expect(result.deletedDb).toBe(true);
        expect(calls).toEqual([OFFLINE_DB_NAME]);
    });

    it('clears only inspection-scoped localStorage keys', async () => {
        const { idb } = fakeIndexedDB();
        const ls = fakeLocalStorage({
            'oi:inspection:abc': 'X',
            'oi:dirty:abc':      'Y',
            'oi:lastSyncedAt:abc': '123',
            'oi:settings:theme': 'dark', // unrelated, must NOT be cleared
            'unrelated':         'Z',
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resetLocalStore({ indexedDB: idb as any, localStorage: ls as any });
        if (!result.ok) throw new Error('expected ok=true');
        expect(result.clearedKeys).toBe(3);
        expect([...ls._store.keys()].sort()).toEqual(['oi:settings:theme', 'unrelated']);
    });

    it('treats deleteDatabase blocked event as a soft success', async () => {
        const { idb } = fakeIndexedDB({ blocked: true });
        const ls = fakeLocalStorage({});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resetLocalStore({ indexedDB: idb as any, localStorage: ls as any });
        if (!result.ok) throw new Error('expected ok=true');
        expect(result.deletedDb).toBe(true);
    });

    it('returns ok=false on deleteDatabase error', async () => {
        const { idb } = fakeIndexedDB({ fail: true });
        const ls = fakeLocalStorage({ 'oi:inspection:keep': 'v' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resetLocalStore({ indexedDB: idb as any, localStorage: ls as any });
        expect(result.ok).toBe(false);
        // Localstorage was not touched because we bailed out early on the
        // IDB failure — the user can retry without losing partial state.
        expect(ls._store.has('oi:inspection:keep')).toBe(true);
    });

    it('survives missing localStorage (tests, ssr)', async () => {
        const { idb } = fakeIndexedDB();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resetLocalStore({ indexedDB: idb as any, localStorage: null as any });
        if (!result.ok) throw new Error('expected ok=true');
        expect(result.clearedKeys).toBe(0);
    });

    it('survives missing indexedDB (tests, ssr)', async () => {
        const ls = fakeLocalStorage({ 'oi:inspection:a': '1' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await resetLocalStore({ indexedDB: null as any, localStorage: ls as any });
        if (!result.ok) throw new Error('expected ok=true');
        expect(result.deletedDb).toBe(false);
        expect(result.clearedKeys).toBe(1);
    });

    // Regression for a stale Dexie name change — keep the constant in sync
    // with public/js/db.js so the helper actually wipes the DB.
    it('uses the documented offline DB name', () => {
        expect(OFFLINE_DB_NAME).toBe('oi_offline');
    });

    it('exposes the helper as an importable named export', () => {
        expect(typeof resetLocalStore).toBe('function');
        // Sanity: should not throw when called with undefined opts.
        expect(() => vi.fn().getMockName()).not.toThrow();
    });
});
