/**
 * The bundled-content sweep.
 *
 * ── The gap it closes ───────────────────────────────────────────────────────
 * An upgrade carried schema (`db:migrate*:remote` is in the deploy chain) and
 * code, and carried no CONTENT. The seeder was reachable only from provisioning
 * — `/setup` in standalone, the portal command in SaaS — both of which run once,
 * on day one. So anything added to the bundled content later reached new
 * workspaces and no existing one, silently, forever.
 *
 * That is not hypothetical. The role-profile seeder joined the starter content
 * after workspaces already existed, so on every one of them it had never run:
 * `contact_role_profiles` was empty, the People section offered no role to
 * assign anybody, and nothing anywhere reported a fault. The deployment was
 * healthy by every measure it had.
 *
 * `POST /api/admin/data/install-bundled-content` was built to close this, and
 * closes it one workspace at a time for an owner who knows to press it. A
 * remedy that has to be discovered is not a remedy for a failure that is
 * silent — the operator who would press it is the operator who does not know
 * anything is missing. This job is the part that does not wait to be asked.
 *
 * ── Why it is shaped like this ──────────────────────────────────────────────
 * One workspace per invocation. `seedStarterContent` pulls in the whole fixture
 * payload — seven seed templates, 250+ canned comments, the marketplace packs —
 * and the Workers Free ceiling is 10 ms PER INVOCATION, so the batch size is
 * what keeps it inside the budget rather than any property of the seeder. The
 * consumer re-enqueues with the cursor immediately, so a fleet drains in
 * consecutive invocations rather than consecutive ticks.
 *
 * The cursor is the last workspace ATTEMPTED, not the last one completed. A
 * workspace whose seed throws is therefore stepped over instead of retried
 * forever: it stays unstamped, so the next tick's probe still sees it and the
 * sweep tries it again from the top — but this sweep finishes, and the
 * workspaces behind it in id order are not held hostage by it.
 */
import { and, asc, gt, isNull, ne, or, eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import { STARTER_CONTENT_VERSION } from '../../services/starter-content/content-version';
import { logger } from '../../lib/logger';
import { TICK, db, type CronJob } from '../types';

/**
 * Workspaces that have not been given this release's content.
 *
 * The `isNull` arm is not redundant with the `ne`: in SQL `content_version <>
 * 'c1'` evaluates to NULL — not true — when the column is NULL, so a predicate
 * written as the inequality alone would skip exactly the workspaces that have
 * never been swept, which are the ones this job exists for.
 *
 * Exported for one reason: that NULL arm is a claim about SQL semantics, not
 * about this file, and the only way to check a claim about SQL is to ask a
 * database. `tests/unit/tooling/cron-content-sweep.spec.ts` runs this exact
 * expression against real sqlite rather than a paraphrase of it — a predicate
 * retyped in a test agrees with the test and with nothing else.
 */
export const behind = () => or(
    isNull(tenants.contentVersion),
    ne(tenants.contentVersion, STARTER_CONTENT_VERSION),
);

export const contentSeedSweepJob: CronJob = {
    key: 'content-seed-sweep',
    label: 'Give existing workspaces the bundled content this release added',
    trigger: TICK,
    // Both. A standalone deployment has one workspace rather than many, and it
    // upgrades by pulling a new release — which is precisely the path that used
    // to bring schema and code and no content.
    modes: ['standalone', 'saas'],
    // One workspace. See the header: this bounds the fixture payload's cost to
    // a single Free-tier invocation budget.
    maxBatch: 1,
    probe: async (env) => db(env)
        .select({ id: tenants.id }).from(tenants)
        .where(behind()).limit(1).all()
        .then((rows) => rows.length),
    run: async (env, cursor) => {
        const d = db(env);
        // LIMIT 2 rather than 1: the second row is how this run learns whether
        // to hand the consumer a cursor, without paying for a second query and
        // without an unbounded COUNT over the table.
        const due = await d.select({ id: tenants.id }).from(tenants)
            .where(cursor ? and(behind(), gt(tenants.id, cursor)) : behind())
            .orderBy(asc(tenants.id))
            .limit(2)
            .all();
        if (due.length === 0) return { processed: 0, nextCursor: null };

        const [target] = due;
        const nextCursor = due.length > 1 ? target.id : null;

        const { seedStarterContent } = await import('../../services/starter-content.service');
        const seeded = await seedStarterContent(env.DB, target.id);

        // Stamped only now. Written before the seed, this would mark a
        // workspace done on the run that failed to finish it — and because the
        // stamp is what the probe reads, that workspace would never be offered
        // again.
        await d.update(tenants)
            .set({ contentVersion: STARTER_CONTENT_VERSION })
            .where(eq(tenants.id, target.id))
            .run();

        logger.info('[cron] bundled content swept', {
            tenantId: target.id, contentVersion: STARTER_CONTENT_VERSION, ...seeded,
        });
        return { processed: 1, nextCursor };
    },
};
