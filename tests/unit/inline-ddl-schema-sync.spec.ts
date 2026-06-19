import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { tenantConfigs } from '../../server/lib/db/schema';
import { TENANT_CONFIGS_TEST_DDL } from '../helpers/inline-ddl';

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
});
