/**
 * Iter-2 bug #12 — type stub for the reset-local-store browser helper.
 */
export const OFFLINE_DB_NAME: string;

export interface ResetLocalStoreOptions {
    indexedDB?:    IDBFactory | null;
    localStorage?: Storage | null;
    dbName?:       string;
}

export type ResetLocalStoreResult =
    | { ok: true;  deletedDb: boolean; clearedKeys: number }
    | { ok: false; error: string };

export function resetLocalStore(opts?: ResetLocalStoreOptions): Promise<ResetLocalStoreResult>;
export function resetLocalAndReload(): Promise<ResetLocalStoreResult>;
