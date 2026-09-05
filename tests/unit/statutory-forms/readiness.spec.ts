/**
 * `statutoryReadiness` — can this deployment produce a statutory form today?
 *
 * The finding this answers: producing one needs a template (an administrator),
 * the authority's PDF (the OWNER), and a printed licence class (the inspector).
 * Each refuses well on its own; none of them can be seen from where the others
 * are, and the person who discovers a gap is usually not the person who can
 * close it.
 *
 * The assertions below are mostly about the two ways a readiness view goes
 * wrong: ticking green on evidence that does not answer the question (a
 * SUPERSEDED revision's PDF), and reading somebody else's workspace.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { statutoryReadiness } from '../../../server/services/statutory/readiness';
import type { StatutoryFormVersion } from '../../../server/lib/statutory/form-registry';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { r2Keys } from '../../../server/lib/r2-keys';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Role } from '../../../server/lib/auth/roles';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER = '11111111-1111-1111-1111-1111111111b2';
const FORM = 'xx_demo_form';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1);

/**
 * Two revisions: one superseded, one in force today.
 *
 * Built WITHOUT a cast. The first draft of this fixture wrote `published: true`
 * — a field the interface does not have — and reached it through
 * `as unknown as StatutoryFormVersion`, so the compiler said nothing and eight
 * tests failed at runtime inside `isPublishedVersion`. Typed literally, the
 * compiler is the thing that knows the shape.
 */
const OLD: StatutoryFormVersion = {
    formId: FORM,
    formTitle: 'Example Authority Demo Form',
    version: 'Rev. 01/25',
    sourceHash: 'a'.repeat(64),
    sourceUrl: 'https://example.gov/old.pdf',
    effectiveFrom: NOW - 400 * DAY,
    mandatoryFrom: NOW - 400 * DAY,
    effectiveUntil: NOW - 10 * DAY,
    publishedBy: 'fixture',
    publishedAt: NOW - 400 * DAY,
    withdrawn: null,
};

const CURRENT: StatutoryFormVersion = {
    ...OLD,
    version: 'Rev. 04/26',
    sourceHash: 'b'.repeat(64),
    effectiveFrom: NOW - 10 * DAY,
    mandatoryFrom: NOW - 10 * DAY,
    effectiveUntil: null,
    publishedAt: NOW - 10 * DAY,
};

const VERSIONS = [OLD, CURRENT];

/** An R2 double that holds exactly the keys it is given. */
function bucketWith(keys: string[]): R2Bucket {
    return {
        head: vi.fn(async (key: string) => (keys.includes(key) ? { size: 1 } : null)),
    } as unknown as R2Bucket;
}

function templateRow(id: string, tenantId: string, declaredForm: string | null) {
    return {
        id,
        tenantId,
        name: id,
        version: 1,
        schema: declaredForm === null
            ? { sections: [] }
            : { sections: [], statutoryForm: { formId: declaredForm, revision: CURRENT.version } },
        createdAt: new Date(NOW),
    };
}

/**
 * A member row with a STABLE shape.
 *
 * The first version spread `statutoryLicenseType` in conditionally, which makes
 * the key optional in the inferred type and leaves drizzle's array-insert
 * overload unable to match — a type error, not a runtime one, and it surfaced
 * only in the full `type-check` because vitest strips types. Always present,
 * null when unset, is both simpler and what the column actually is.
 */
function userRow(id: string, tenantId: string, role: Role, licence: string | null) {
    return {
        id, tenantId, email: `${id}@a.test`, name: id, role,
        passwordHash: 'x', createdAt: new Date(NOW),
        statutoryLicenseType: licence,
    };
}

describe('statutoryReadiness', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        await db.insert(schema.tenants).values([
            { id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(NOW) },
            { id: OTHER, slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(NOW) },
        ]);
    });

    const run = (bucket: R2Bucket | undefined) => statutoryReadiness({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db: db as any,
        tenantId: TENANT,
        bucket,
        versions: VERSIONS,
        now: NOW,
    });

    it('reports the revision in force today, not the newest or the oldest', async () => {
        const { forms } = await run(bucketWith([]));
        expect(forms).toHaveLength(1);
        expect(forms[0].currentRevision).toBe(CURRENT.version);
    });

    // THE ASSERTION THIS FILE EXISTS FOR. A superseded revision's document is a
    // real file for a real form — and it is not the one a job booked today
    // needs. Ticking green on it would answer a question nobody asked.
    it('does NOT call the source stored when only a SUPERSEDED revision is on disk', async () => {
        const supersededOnly = bucketWith([r2Keys.statutoryFormSource(FORM, OLD.version)]);
        const { forms } = await run(supersededOnly);
        expect(forms[0].sourceStored).toBe(false);
    });

    it('calls it stored when the revision in force is on disk', async () => {
        const current = bucketWith([r2Keys.statutoryFormSource(FORM, CURRENT.version)]);
        const { forms } = await run(current);
        expect(forms[0].sourceStored).toBe(true);
    });

    it('reports nothing stored when the deployment has no bucket at all', async () => {
        // A different problem from an absent file, and it must not read as one
        // that uploading could fix.
        const { forms } = await run(undefined);
        expect(forms[0].sourceStored).toBe(false);
    });

    it('sees a template that declares the form, and ignores one that declares nothing', async () => {
        await db.insert(schema.templates).values([
            templateRow('t-plain', TENANT, null),
            templateRow('t-statutory', TENANT, FORM),
        ]);
        const { forms } = await run(bucketWith([]));
        expect(forms[0].templateInstalled).toBe(true);
    });

    it('does not count another workspace\'s template as installed here', async () => {
        await db.insert(schema.templates).values([templateRow('t-elsewhere', OTHER, FORM)]);
        const { forms } = await run(bucketWith([]));
        // Without the tenant filter this reads true, and an owner is told a
        // form is ready that nobody in their workspace can open.
        expect(forms[0].templateInstalled).toBe(false);
    });

    it('counts licence classes as a fraction of active non-agent members', async () => {
        await db.insert(schema.users).values([
            userRow('u-owner', TENANT, 'owner', 'Florida-licensed home inspector'),
            userRow('u-blank', TENANT, 'inspector', null),
            userRow('u-space', TENANT, 'inspector', '   '),
            // Agents cannot sign anything; counting them would make a fully
            // configured workspace read as partly configured.
            userRow('u-agent', TENANT, 'agent', null),
            userRow('u-other', OTHER, 'inspector', 'Texas-licensed'),
        ]);
        const { licenceClass } = await run(bucketWith([]));
        expect(licenceClass).toEqual({ filled: 1, total: 3 });
    });

    it('still names a form that has no revision in force today', async () => {
        // Between two revisions, or before the first one. The row has to stay
        // legible — an unnamed id here is the defect this project already fixed
        // once on the settings page.
        const { forms } = await statutoryReadiness({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            db: db as any,
            tenantId: TENANT,
            bucket: bucketWith([]),
            versions: VERSIONS,
            now: OLD.effectiveFrom - DAY,
        });
        expect(forms[0].currentRevision).toBeNull();
        expect(forms[0].formTitle).toBe('Example Authority Demo Form');
    });
});
