import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { tenantConfigs, inspectionResults, users, accountAcceptances, migrationBatches, migrationRows, auditLogs, tenants } from '../../../server/lib/db/schema';
import {
    TENANT_CONFIGS_TEST_DDL, INSPECTION_RESULTS_TEST_DDL, USERS_TEST_DDL,
    ACCOUNT_ACCEPTANCES_TEST_DDL, MIGRATION_BATCHES_TEST_DDL, MIGRATION_ROWS_TEST_DDL,
    AUDIT_LOGS_TEST_DDL, TENANTS_TEST_DDL,
} from '../../helpers/inline-ddl';

/**
 * Drift guard for the hand-maintained workers-runtime DDL.
 *
 * The cmd-consumer / cmd-fixtures workers specs create `tenant_configs` from a
 * literal CREATE TABLE string instead of replaying migrations. Every time the
 * Drizzle schema gains a column, the cmd-apply upsert binds it — and if the
 * hand-written DDL lacks that column the statement parks and `test:workers`
 * fails (this blocked #164). That failure surfaces only in a real workerd run,
 * which is slow and easy to skip locally.
 *
 * This fast unit test asserts the shared DDL covers every Drizzle column, so the
 * drift is caught the moment a column is added — see CLAUDE.md "Comment Rules":
 * a "must stay in sync" coupling is made executable instead of left as a comment.
 *
 * Extra columns in the DDL (e.g. the legacy `secrets` column) are fine; only
 * MISSING columns break the apply path, so we assert coverage, not equality.
 */
function ddlColumnNames(ddl: string): Set<string> {
    const open = ddl.indexOf('(');
    const close = ddl.lastIndexOf(')');
    const body = ddl.slice(open + 1, close);
    // No nested parens in this DDL (every column is `name TYPE [constraints]`),
    // so a top-level comma split is safe; the column name is the first token.
    return new Set(
        body
            .split(',')
            .map((col) => col.trim().split(/\s+/)[0])
            .filter(Boolean),
    );
}

describe('workers inline DDL stays in sync with the Drizzle schema', () => {
    it('tenant_configs test DDL covers every Drizzle schema column', () => {
        const ddlColumns = ddlColumnNames(TENANT_CONFIGS_TEST_DDL);
        const schemaColumns = getTableConfig(tenantConfigs).columns.map((c) => c.name);
        const missing = schemaColumns.filter((name) => !ddlColumns.has(name));
        expect(
            missing,
            `tests/helpers/inline-ddl.ts is missing tenant_configs column(s): ${missing.join(', ')}. ` +
                'Add them to TENANT_CONFIGS_TEST_DDL so the workers cmd-apply path does not park.',
        ).toEqual([]);
    });

    it('users test DDL covers every Drizzle schema column', () => {
        // Learned a THIRD time, and this one reached CI: adding
        // `service_origin_*` to the users schema parked `applyAdminCredential`
        // in real workerd with "table users has no column named
        // service_origin_address". The reasoning that let it through was
        // "drizzle only binds the columns you pass" — it does not.
        // `db.insert(users).values({ id, email, … })` emits EVERY column of the
        // table and nulls the rest, so a partial insert is exactly as exposed
        // to this drift as a full one. lint, test:unit and test:web are all
        // blind to it; this assertion is not.
        const ddlColumns = ddlColumnNames(USERS_TEST_DDL);
        const schemaColumns = getTableConfig(users).columns.map((c) => c.name);
        const missing = schemaColumns.filter((name) => !ddlColumns.has(name));
        expect(
            missing,
            `tests/helpers/inline-ddl.ts is missing users column(s): ${missing.join(', ')}. ` +
                'Add them to USERS_TEST_DDL so the workers cmd-apply path does not park.',
        ).toEqual([]);
    });

    it('account_acceptances test DDL covers every Drizzle schema column', () => {
        // The fourth table, and the one where drift fails LOUDEST rather than
        // quietest: the acceptance rows ride the same `db.batch()` as the users
        // insert, so a column missing here does not park one statement — it
        // rolls back the account too, which is correct behaviour presenting as
        // an incomprehensible failure.
        const ddlColumns = ddlColumnNames(ACCOUNT_ACCEPTANCES_TEST_DDL);
        const schemaColumns = getTableConfig(accountAcceptances).columns.map((c) => c.name);
        const missing = schemaColumns.filter((name) => !ddlColumns.has(name));
        expect(
            missing,
            `tests/helpers/inline-ddl.ts is missing account_acceptances column(s): ${missing.join(', ')}. ` +
                'Add them to ACCOUNT_ACCEPTANCES_TEST_DDL so the workers credential-apply batch does not roll back.',
        ).toEqual([]);
    });

    it('inspection_results test DDL covers every Drizzle schema column', () => {
        // Learned the hard way on the reports work: the DDL was copy-pasted into
        // four collab specs, the Drizzle table gained `report_id`, and the only
        // thing that noticed was the Durable Object's persist() throwing inside
        // real workerd — AFTER lint + test:unit + test:web had all gone green.
        // test:workers is not in the standard three-suite run, so that failure
        // reached CI. This assertion is the fast one that stops it there.
        const ddlColumns = ddlColumnNames(INSPECTION_RESULTS_TEST_DDL);
        const schemaColumns = getTableConfig(inspectionResults).columns.map((c) => c.name);
        const missing = schemaColumns.filter((name) => !ddlColumns.has(name));
        expect(
            missing,
            `tests/helpers/inline-ddl.ts is missing inspection_results column(s): ${missing.join(', ')}. ` +
                'Add them to INSPECTION_RESULTS_TEST_DDL so the collab DO can persist in workers tests.',
        ).toEqual([]);
    });

    /**
     * Tables whose assertion is identical, driven by one loop rather than four
     * copies of the same eight lines -- four near-identical blocks is how the
     * fifth table gets added to the DDL and forgotten here.
     *
     * Each carries its own CONSEQUENCE, because they do not share one. The
     * three `cmd.migration.*` tables park a delivery that is then retried to
     * exhaustion; `tenants` breaks the tenant upsert outright. A loop that
     * printed one seam's consequence for every member would send the next
     * reader to the wrong place, which is what it did for a few minutes here.
     */
    const PARKS = 'Add them, or the cmd.migration.* appliers park in real workerd — which on '
        + 'this seam means the delivery is retried to exhaustion and dies in the dead-letter queue.';
    const TENANT_UPSERT = 'Add them, or handleTenantUpdate fails outright in real workerd: it inserts '
        + 'a PARTIAL object and drizzle still binds every column of the table, so a column here '
        + 'means "table tenants has no column named ...".';

    for (const [label, ddl, table, consequence] of [
        ['migration_batches', MIGRATION_BATCHES_TEST_DDL, migrationBatches, PARKS],
        ['migration_rows', MIGRATION_ROWS_TEST_DDL, migrationRows, PARKS],
        ['audit_logs', AUDIT_LOGS_TEST_DDL, auditLogs, PARKS],
        // Not a cmd.migration.* table -- it is here because the loop is the
        // right shape for it, and a fourth near-identical block is how the
        // fifth table gets forgotten. `tenants` is what proved that: seven
        // copies of its DDL and no assertion over any of them.
        ['tenants', TENANTS_TEST_DDL, tenants, TENANT_UPSERT],
    ] as const) {
        it(`${label} test DDL covers every Drizzle schema column`, () => {
            const ddlColumns = ddlColumnNames(ddl);
            const schemaColumns = getTableConfig(table).columns.map((c) => c.name);
            const missing = schemaColumns.filter((name) => !ddlColumns.has(name));
            expect(
                missing,
                `tests/helpers/inline-ddl.ts is missing ${label} column(s): ${missing.join(', ')}. ` +
                    consequence,
            ).toEqual([]);
        });
    }
});
