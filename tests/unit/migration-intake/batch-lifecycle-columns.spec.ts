/**
 * The columns a batch needs once it can outlive the page that created it.
 *
 * Three groups, and each one exists because something outside this table would
 * otherwise be unreachable: `source_key` is the only thing that knows where the
 * uploaded file went, so re-mapping needs it; `expires_at` is the per-batch
 * clock, because a batch waiting on a human gets a different lifetime from one
 * the operator staged and walked away from; and the two authorisation triples
 * record WHAT was agreed to, not merely THAT something was — the wording moves,
 * and a boolean cannot say what was on the screen at the time.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const BATCH = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

describe('migration_batches lifecycle columns', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
    });

    it('leaves every new column null on a plain staged batch', async () => {
        await db.insert(schema.migrationBatches).values({
            id: BATCH,
            tenantId: TENANT,
            createdBy: 'u1',
            intent: 'contacts.import',
            vendor: 'csv_generic',
            adapterName: 'csv-generic',
            adapterVersion: '1',
            manifest: '{"warnings":[]}',
            createdAt: new Date(),
        });
        const row = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, BATCH)).get();
        expect(row?.sourceKey).toBeNull();
        expect(row?.expiresAt).toBeNull();
        expect(row?.uploadAuthorizedBy).toBeNull();
        expect(row?.uploadAuthorizedAt).toBeNull();
        expect(row?.uploadAuthorizationVersion).toBeNull();
        expect(row?.staffAccessAuthorizedBy).toBeNull();
        expect(row?.staffAccessAuthorizedAt).toBeNull();
        expect(row?.staffAccessAuthorizationVersion).toBeNull();
    });

    it('stores a batch waiting on a human, with both authorisations recorded', async () => {
        const at = new Date('2026-08-18T10:00:00.000Z');
        const due = new Date(at.getTime() + 90 * 24 * 60 * 60 * 1000);
        await db.insert(schema.migrationBatches).values({
            id: BATCH,
            tenantId: TENANT,
            createdBy: 'u1',
            intent: 'assisted.full',
            vendor: 'csv_generic',
            adapterName: 'none',
            adapterVersion: '0',
            manifest: '{"warnings":[]}',
            status: 'needs_assistance',
            createdAt: at,
            sourceKey: `${TENANT}/migrations/${BATCH}/source.csv`,
            expiresAt: due,
            uploadAuthorizedBy: 'u1',
            uploadAuthorizedAt: at,
            uploadAuthorizationVersion: '1',
            staffAccessAuthorizedBy: 'u2',
            staffAccessAuthorizedAt: new Date(at.getTime() + 60_000),
            staffAccessAuthorizationVersion: '1',
        });
        const row = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, BATCH)).get();
        expect(row?.status).toBe('needs_assistance');
        expect(row?.intent).toBe('assisted.full');
        expect(row?.sourceKey).toBe(`${TENANT}/migrations/${BATCH}/source.csv`);
        // The clock has to survive the round trip as a moment in time, not as
        // whatever an integer column happened to keep. A column declared in the
        // wrong unit reads back as a date decades away and every sweep that
        // compares against it silently stops matching.
        expect(row?.expiresAt).toBeInstanceOf(Date);
        expect(row?.expiresAt?.getTime()).toBe(due.getTime());
        // Each authorisation names WHO and WHEN, separately from the other one.
        // Same-shaped columns filled from one source would read as agreement
        // that was never given, so the two are written from different values
        // here and asserted apart.
        expect(row?.uploadAuthorizedBy).toBe('u1');
        expect(row?.uploadAuthorizedAt?.getTime()).toBe(at.getTime());
        expect(row?.uploadAuthorizationVersion).toBe('1');
        expect(row?.staffAccessAuthorizedBy).toBe('u2');
        expect(row?.staffAccessAuthorizedAt?.getTime()).toBe(at.getTime() + 60_000);
        expect(row?.staffAccessAuthorizationVersion).toBe('1');
    });

    it('names the two authorisation versions in one place', async () => {
        const mod = await import('../../../server/lib/migration-intake/authorizations');
        expect(mod.UPLOAD_AUTHORIZATION_VERSION).toBe('1');
        expect(mod.STAFF_ACCESS_AUTHORIZATION_VERSION).toBe('1');
        // Two constants, never one. They authorise different things to
        // different readers, so they have to be able to move apart — a module
        // that grew a single shared version, or lost one of the two, is the
        // failure this pins.
        expect(Object.keys(mod).sort()).toEqual([
            'STAFF_ACCESS_AUTHORIZATION_VERSION',
            'UPLOAD_AUTHORIZATION_VERSION',
        ]);
        // A version is stored verbatim on a batch, so an empty or absent one
        // would be written as a row claiming an authorisation nobody can read
        // back. Both must be non-empty strings.
        for (const value of Object.values(mod)) {
            expect(typeof value).toBe('string');
            expect(value).not.toBe('');
        }
    });

    it('declares each version from its own literal, so one cannot re-version the other', async () => {
        // Read as source rather than as values, because the failure this
        // guards against is invisible at runtime: while the two agree, one
        // defined AS the other is indistinguishable from two that happen to
        // match. The day somebody reweords one and bumps it, an aliased pair
        // silently re-versions an authorisation nobody changed.
        const fs = await import('node:fs');
        const path = await import('node:path');
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../server/lib/migration-intake/authorizations.ts'),
            'utf8',
        );
        const declarations = [...source.matchAll(/export const (\w+) = (.+);/g)]
            .map((m) => [m[1], m[2]] as const);
        expect(declarations.map(([name]) => name).sort()).toEqual([
            'STAFF_ACCESS_AUTHORIZATION_VERSION',
            'UPLOAD_AUTHORIZATION_VERSION',
        ]);
        for (const [, initializer] of declarations) {
            expect(initializer).toMatch(/^'[^']+'$/);
        }
    });
});
