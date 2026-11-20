/**
 * Import revert tests. Revert is the client-driven undo of a data-package
 * import: it removes only the rows the import mapped, in child-first order,
 * leaves edits made after the import alone, protects identity roots, deletes
 * mapped R2 media, and never touches the evidence archive.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db';
import { asScopedDbSource } from '../helpers/test-db';
import { DataPackageRevertService } from '../../../server/services/data-package/import-revert.service';

const TENANT = 'tenant-target';
const OTHER = 'tenant-other';
const PKG = 'pkg-1';
const IMPORT_TIME = 1_700_000_000_000;

function mockBucket() {
    const objects = new Set<string>(['t/insp/i1/photos/a.jpg', 't/insp/i1/photos/b.jpg']);
    const deleted: string[] = [];
    let failDelete = false;
    return {
        objects,
        deleted,
        setFailDelete(v: boolean) { failDelete = v; },
        async delete(key: string) {
            if (failDelete) throw new Error('r2 down');
            objects.delete(key);
            deleted.push(key);
        },
    };
}

describe('DataPackageRevertService', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let db: any;
    let bucket: ReturnType<typeof mockBucket>;
    let svc: DataPackageRevertService;

    beforeEach(() => {
        const setup = createTestDb();
        sqlite = setup.sqlite;
        db = setup.db;
        bucket = mockBucket();
        svc = new DataPackageRevertService(asScopedDbSource(db), bucket as any);
        sqlite.prepare(`INSERT INTO tenants (id, slug, created_at) VALUES (?, ?, ?)`).run(TENANT, 't', IMPORT_TIME);
        sqlite.prepare(`INSERT INTO tenants (id, slug, created_at) VALUES (?, ?, ?)`).run(OTHER, 'o', IMPORT_TIME);
    });

    /** Add an import_id_map anchor. `createdAt` defaults to the import time. */
    const map = (table: string, newId: string, opts: { tenant?: string; pkg?: string; createdAt?: number; kept?: boolean } = {}) =>
        sqlite.prepare(
            `INSERT INTO import_id_map (id, tenant_id, package_id, table_name, source_id, new_id, created_at, is_kept)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            `map:${opts.tenant ?? TENANT}:${table}:${newId}`, opts.tenant ?? TENANT, opts.pkg ?? PKG,
            table, `src:${newId}`, newId, opts.createdAt ?? IMPORT_TIME, opts.kept ? 1 : 0,
        );

    const keptOf = (newId: string): number | undefined =>
        sqlite.prepare(`SELECT is_kept FROM import_id_map WHERE new_id = ?`).get(newId)?.is_kept;

    const contact = (id: string, tenant = TENANT) => sqlite.prepare(
        `INSERT INTO contacts (id, tenant_id, name, email, type, created_at) VALUES (?, ?, ?, ?, 'client', ?)`,
    ).run(id, tenant, id, `${id}@x.test`, IMPORT_TIME);

    // inspector_credentials has updated_at in BOTH schema and migration, unlike
    // inspections (schema-only drift). Needs a user parent for its FK.
    const user = (id: string, tenant = TENANT) => sqlite.prepare(
        `INSERT INTO users (id, tenant_id, email, password_hash, name, created_at)
         VALUES (?, ?, ?, 'hash', ?, ?)`,
    ).run(id, tenant, `${id}@x.test`, id, IMPORT_TIME);
    const credential = (id: string, updatedAt: number, tenant = TENANT) => {
        user(`user-${id}`, tenant);
        return sqlite.prepare(
            `INSERT INTO inspector_credentials (id, tenant_id, user_id, label, created_at, updated_at)
             VALUES (?, ?, ?, 'CPI', ?, ?)`,
        ).run(id, tenant, `user-${id}`, IMPORT_TIME, updatedAt);
    };

    // `inspections` has NO updated_at (schema or migration). Import-time change
    // is detected via status timestamps that postdate the import moment.
    const inspection = (
        id: string,
        stamps: { confirmedAt?: number | null; unlockedAt?: number | null; reportsGeneratedAt?: number | null } = {},
        tenant = TENANT,
    ) => sqlite.prepare(
        `INSERT INTO inspections
            (id, tenant_id, property_address, date, status, created_at, confirmed_at, unlocked_at, reports_generated_at)
         VALUES (?, ?, 'x', '2026-01-01', 'scheduled', ?, ?, ?, ?)`,
    ).run(
        id, tenant, IMPORT_TIME,
        stamps.confirmedAt ?? null, stamps.unlockedAt ?? null, stamps.reportsGeneratedAt ?? null,
    );

    const rowCount = (table: string, id: string) =>
        sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`).get(id).n;
    const mapCount = (tenant = TENANT, pkg = PKG) =>
        sqlite.prepare(`SELECT COUNT(*) AS n FROM import_id_map WHERE tenant_id = ? AND package_id = ?`).get(tenant, pkg).n;

    it('deletes mapped rows and clears their mappings, reporting done', async () => {
        contact('c-1'); contact('c-2');
        map('contacts', 'c-1'); map('contacts', 'c-2');
        const r = await svc.revertStep(TENANT, PKG);
        expect(r.deleted.contacts).toBe(2);
        expect(r.errors).toEqual([]);
        expect(r.done).toBe(true);
        expect(rowCount('contacts', 'c-1')).toBe(0);
        expect(rowCount('contacts', 'c-2')).toBe(0);
        expect(mapCount()).toBe(0);
    });

    it('does NOT touch rows with no mapping (pre-existing target data)', async () => {
        contact('c-imported'); contact('c-original');
        map('contacts', 'c-imported');
        await svc.revertStep(TENANT, PKG);
        expect(rowCount('contacts', 'c-imported')).toBe(0);
        expect(rowCount('contacts', 'c-original')).toBe(1); // untouched
    });

    it('keeps a row the owner edited after the import (updated_at advanced)', async () => {
        // edited well after the import moment → must be preserved
        credential('cred-edited', IMPORT_TIME + 10_000);
        credential('cred-clean', IMPORT_TIME);
        map('inspector_credentials', 'cred-edited'); map('inspector_credentials', 'cred-clean');
        const r = await svc.revertStep(TENANT, PKG);
        expect(rowCount('inspector_credentials', 'cred-edited')).toBe(1);
        expect(r.kept).toContainEqual({ table: 'inspector_credentials', newId: 'cred-edited', reason: 'modified_kept' });
        expect(rowCount('inspector_credentials', 'cred-clean')).toBe(0);
        expect(r.deleted.inspector_credentials).toBe(1);
    });

    it('keeps an inspection changed after import (status timestamp past import) and marks its mapping kept', async () => {
        // confirmed_at postdates the import moment → owner/system changed it →
        // preserve the row, mark the mapping kept (stays read-only + quota-exempt)
        // and still finish the loop.
        inspection('insp-confirmed', { confirmedAt: IMPORT_TIME + 10_000 });
        inspection('insp-clean', { confirmedAt: IMPORT_TIME - 10_000 });
        map('inspections', 'insp-confirmed'); map('inspections', 'insp-clean');
        const r = await svc.revertStep(TENANT, PKG);
        expect(rowCount('inspections', 'insp-confirmed')).toBe(1);
        expect(r.kept).toContainEqual({ table: 'inspections', newId: 'insp-confirmed', reason: 'modified_kept' });
        expect(keptOf('insp-confirmed')).toBe(1); // mapping preserved for exemption
        expect(rowCount('inspections', 'insp-clean')).toBe(0);
        expect(keptOf('insp-clean')).toBeUndefined(); // mapping deleted (no row left)
        expect(r.deleted.inspections).toBe(1);
        expect(r.done).toBe(true);               // kept mapping excluded from done
    });

    it('deletes an inspection whose status timestamps are all null or before import', async () => {
        inspection('insp-null');
        inspection('insp-past', { unlockedAt: IMPORT_TIME - 1, reportsGeneratedAt: IMPORT_TIME - 5 });
        map('inspections', 'insp-null'); map('inspections', 'insp-past');
        const r = await svc.revertStep(TENANT, PKG);
        expect(r.errors).toEqual([]);
        expect(r.deleted.inspections).toBe(2);
        expect(rowCount('inspections', 'insp-null')).toBe(0);
        expect(rowCount('inspections', 'insp-past')).toBe(0);
        expect(r.done).toBe(true);
    });

    it('excludes kept mappings from the revert scope so the loop can finish', async () => {
        // A pre-existing kept mapping (owner's data from a prior step) must not
        // be reprocessed, must not block done, and its row must survive.
        inspection('insp-kept', { unlockedAt: IMPORT_TIME + 5 });
        map('inspections', 'insp-kept', { kept: true });
        const r = await svc.revertStep(TENANT, PKG);
        expect(r.processed).toBe(0);
        expect(r.done).toBe(true);
        expect(rowCount('inspections', 'insp-kept')).toBe(1);
    });

    it('protects identity roots: tenants and users are never deleted', async () => {
        // the tenant row itself was mapped during a keep-ids import
        map('tenants', TENANT);
        const r = await svc.revertStep(TENANT, PKG);
        expect(rowCount('tenants', TENANT)).toBe(1);
        expect(r.kept).toContainEqual({ table: 'tenants', newId: TENANT, reason: 'protected' });
        expect(r.done).toBe(true);
    });

    it('deletes mapped R2 media objects but leaves the evidence archive intact', async () => {
        sqlite.prepare(
            `INSERT INTO import_archives (id, tenant_id, package_id, sha256, created_at) VALUES (?, ?, ?, ?, ?)`,
        ).run('arch-1', TENANT, PKG, 'abc', IMPORT_TIME);
        map('__media', 't/insp/i1/photos/a.jpg');
        map('__media', 't/insp/i1/photos/b.jpg');
        const r = await svc.revertStep(TENANT, PKG);
        expect(r.mediaDeleted).toBe(2);
        expect(bucket.deleted).toHaveLength(2);
        expect(bucket.objects.size).toBe(0);
        // archive ledger + bytes are never removed by revert
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM import_archives`).get().n).toBe(1);
    });

    it('is tenant-scoped: another tenant\'s mappings are left alone', async () => {
        contact('c-mine'); contact('c-theirs', OTHER);
        map('contacts', 'c-mine'); map('contacts', 'c-theirs', { tenant: OTHER });
        const r = await svc.revertStep(TENANT, PKG);
        expect(rowCount('contacts', 'c-mine')).toBe(0);
        expect(rowCount('contacts', 'c-theirs')).toBe(1);
        expect(mapCount(OTHER)).toBe(1);
    });

    it('a step is bounded and done flips false while mappings remain', async () => {
        for (let i = 0; i < 5; i++) { contact(`c-${i}`); map('contacts', `c-${i}`); }
        const first = await svc.revertStep(TENANT, PKG, 2);
        expect(first.processed).toBe(2);
        expect(first.done).toBe(false);
        expect(mapCount()).toBe(3);
        const second = await svc.revertStep(TENANT, PKG, 2);
        expect(second.processed).toBe(2);
        expect(second.done).toBe(false);
        const third = await svc.revertStep(TENANT, PKG, 2);
        expect(third.done).toBe(true);
        expect(mapCount()).toBe(0);
    });

    it('rejects a forged mapping to a non-row table without touching anything', async () => {
        map('secrets_table', 'x');
        const r = await svc.revertStep(TENANT, PKG);
        expect(r.kept).toContainEqual({ table: 'secrets_table', newId: 'x', reason: 'unsupported' });
        expect(r.done).toBe(true);
    });

    it('a failed R2 delete keeps the mapping so a later step retries', async () => {
        map('__media', 't/insp/i1/photos/a.jpg');
        bucket.setFailDelete(true);
        const first = await svc.revertStep(TENANT, PKG);
        expect(first.errors).toContainEqual({ table: '__media', newId: 't/insp/i1/photos/a.jpg', code: 'media_delete_failed' });
        expect(first.done).toBe(false);
        expect(mapCount()).toBe(1);
        bucket.setFailDelete(false);
        const second = await svc.revertStep(TENANT, PKG);
        expect(second.mediaDeleted).toBe(1);
        expect(second.done).toBe(true);
    });

    it('keeps the exists-only fallback for non-inspection tables without updated_at', async () => {
        // contacts has no updated_at; the narrow "no such column" catch must
        // still degrade to existence-only and delete. (inspections no longer
        // uses this path — it uses the status-timestamp judgement.)
        contact('c-noupd');
        map('contacts', 'c-noupd');
        const r = await svc.revertStep(TENANT, PKG);
        expect(r.errors).toEqual([]);
        expect(r.deleted.contacts).toBe(1);
        expect(rowCount('contacts', 'c-noupd')).toBe(0);
        expect(r.done).toBe(true);
    });

    it('a transient probe error is reported and NEVER degrades to a delete', async () => {
        // A non-"no such column" failure (e.g. transient DB error) must NOT be
        // mistaken for a missing column — that would delete a row the owner may
        // have edited. Wrap the db so the first get() (the updated_at probe)
        // throws a generic error, and assert the row and mapping both survive.
        contact('c-transient');
        map('contacts', 'c-transient');
        let thrown = false;
        const flakyDb = new Proxy(db, {
            get(target, prop, receiver) {
                if (prop === 'get' && !thrown) {
                    thrown = true;
                    return async () => { throw new Error('database is locked'); };
                }
                return Reflect.get(target, prop, receiver);
            },
        });
        const flakySvc = new DataPackageRevertService(asScopedDbSource(flakyDb), bucket as any);
        const r = await flakySvc.revertStep(TENANT, PKG);
        expect(r.errors).toContainEqual({ table: 'contacts', newId: 'c-transient', code: 'probe_failed' });
        expect(rowCount('contacts', 'c-transient')).toBe(1);   // row preserved
        expect(mapCount()).toBe(1);                            // mapping kept for retry
        expect(r.done).toBe(false);
        // A later step with the healthy service succeeds.
        const retry = await svc.revertStep(TENANT, PKG);
        expect(retry.deleted.contacts).toBe(1);
        expect(retry.done).toBe(true);
    });

    it('a transient inspection-status probe error is reported without aborting the batch', async () => {
        // The inspections status-timestamp probe must catch transient DB errors
        // (locked row) as probe_failed and leave the mapping for retry, not
        // throw out of the whole step.
        inspection('insp-transient');
        map('inspections', 'insp-transient');
        let thrown = false;
        const flakyDb = new Proxy(db, {
            get(target, prop, receiver) {
                if (prop === 'get' && !thrown) {
                    thrown = true;
                    return async () => { throw new Error('database is locked'); };
                }
                return Reflect.get(target, prop, receiver);
            },
        });
        const flakySvc = new DataPackageRevertService(asScopedDbSource(flakyDb), bucket as any);
        const r = await flakySvc.revertStep(TENANT, PKG);
        expect(r.errors).toContainEqual({ table: 'inspections', newId: 'insp-transient', code: 'probe_failed' });
        expect(rowCount('inspections', 'insp-transient')).toBe(1);
        expect(mapCount()).toBe(1);
        expect(r.done).toBe(false);
    });
});
