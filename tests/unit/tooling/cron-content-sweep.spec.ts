/**
 * The predicate that decides which workspaces the bundled-content sweep offers
 * content to.
 *
 * Everything else about the job is arrangement — a LIMIT, a cursor, an update.
 * This one expression is a claim about SQL's three-valued logic, and getting it
 * wrong fails in the one direction nobody notices: `content_version <> 'c1'`
 * evaluates to NULL, not TRUE, for a row where the column is NULL, so the
 * inequality ALONE silently excludes every workspace that has never been swept
 * — which is precisely the population the job exists to reach. The sweep would
 * run, report success, and skip every workspace that predates the sweep, which
 * is the entire set it was written for.
 *
 * So it is asked of a real database, using the expression the job actually
 * runs rather than a copy typed here. A copy would agree with this file and
 * with nothing else.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import Database from 'better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { tenants } from '../../../server/lib/db/schema';
import { behind } from '../../../server/cron/jobs/content';
import { STARTER_CONTENT_VERSION } from '../../../server/services/starter-content/content-version';
import { setupSchema } from '../db';

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

const CURRENT = STARTER_CONTENT_VERSION;
const OLDER = `${STARTER_CONTENT_VERSION}-previous`;

beforeAll(async () => {
    const sqlite = new Database(':memory:');
    await setupSchema(sqlite);
    db = drizzle(sqlite, { schema });

    // Three workspaces, one per state the column can be in.
    const rows = [
        { id: 'w-never', version: null },
        { id: 'w-older', version: OLDER },
        { id: 'w-current', version: CURRENT },
    ];
    for (const r of rows) {
        await db.insert(tenants).values({
            id: r.id,
            slug: r.id,
            createdAt: new Date(0),
            contentVersion: r.version,
        }).run();
    }
});

const swept = async () => (await db.select({ id: tenants.id }).from(tenants).where(behind()).all())
    .map((r) => r.id).sort();

describe('content-seed-sweep — which workspaces are behind', () => {
    it('CONTROL — the three fixtures really are in the three distinct states', () => {
        // Without this, every assertion below is satisfiable by a table whose
        // rows all look alike, and "the predicate selects two of three" would
        // be a statement about nothing.
        expect(db.select().from(tenants).all().map((r) => r.contentVersion).sort())
            .toEqual([CURRENT, OLDER, null].sort());
    });

    it('offers content to a workspace that has NEVER been swept', async () => {
        expect(await swept()).toContain('w-never');
    });

    it('offers content to a workspace stamped with an older release', async () => {
        expect(await swept()).toContain('w-older');
    });

    it('leaves a workspace already on this release alone', async () => {
        expect(await swept()).not.toContain('w-current');
    });

    it('selects exactly those two and nothing else', async () => {
        expect(await swept()).toEqual(['w-never', 'w-older']);
    });

    it('NEGATIVE CONTROL — the inequality alone loses the never-swept workspace', async () => {
        // This is the bug the isNull arm exists to prevent, demonstrated rather
        // than described. If SQL ever stopped treating `NULL <> x` as NULL this
        // test would fail, and the comment on `behind()` would need rewriting.
        const withoutNullArm = await db.select({ id: tenants.id }).from(tenants)
            .where(ne(tenants.contentVersion, CURRENT)).all();
        expect(withoutNullArm.map((r) => r.id)).toEqual(['w-older']);
        expect(withoutNullArm.map((r) => r.id)).not.toContain('w-never');
    });

    it('stays correct when combined with the cursor, which is how run() uses it', async () => {
        // run() wraps the same predicate in `and(..., gt(id, cursor))`. The risk
        // is precedence: an OR that is not parenthesised inside the AND would
        // match every row with a NULL version regardless of the cursor.
        const afterNever = await db.select({ id: tenants.id }).from(tenants)
            .where(and(behind(), or(eq(tenants.id, 'w-older'), isNull(tenants.id)))).all();
        expect(afterNever.map((r) => r.id)).toEqual(['w-older']);
    });
});
