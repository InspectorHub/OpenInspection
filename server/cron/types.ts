/**
 * The vocabulary the cron registry is written in: the three cron expressions,
 * the job shape, and the two helpers every probe uses.
 *
 * Separate from `registry.ts` so the job modules can import the shape without
 * importing the list, and so the list stays readable as a list.
 */
import { drizzle } from 'drizzle-orm/d1';
import type { ScheduledEnv } from '../scheduled';

export const TICK = '*/5 * * * *';
export const DAILY_03 = '0 3 * * *';
export const DAILY_04 = '0 4 * * *';

/** Deployment topologies a job can belong to. Read through `CronJob.modes`. */
type DeploymentMode = 'standalone' | 'saas';

/** What one bounded batch reports back. Reached through `CronJob["run"]`. */
interface CronRunResult {
    processed: number;
    /** Where to resume, or null when the sweep is complete. */
    nextCursor: string | null;
}

export interface CronJob {
    /** Stable id. Appears in queue messages and cursor keys - renaming one strands its cursor. */
    key: string;
    label: string;
    trigger: typeof TICK | typeof DAILY_03 | typeof DAILY_04;
    modes: DeploymentMode[];
    /**
     * Is there work? Cheap by contract: at most a COUNT or a LIMIT-1 SELECT,
     * reusing the SAME predicate the job's own query already uses. Never parse
     * a row body here - the whole point is that an idle tick costs almost no
     * CPU. Returns an approximate count; only `> 0` is acted on.
     */
    probe: (env: ScheduledEnv) => Promise<number>;
    /**
     * Do at most `maxBatch` units of work starting at `cursor`. Returns the
     * cursor to resume from, or null when the sweep is complete. MUST fit the
     * 10 ms Free CPU ceiling for one batch - that is what maxBatch bounds.
     */
    run: (env: ScheduledEnv, cursor: string | null) => Promise<CronRunResult>;
    /** Units per invocation. */
    maxBatch: number;
}

/** One D1 handle per call; drizzle() itself is cheap and holds no connection. */
export const db = (env: ScheduledEnv) => drizzle(env.DB);

/** A LIMIT-1 existence check, expressed once so every probe reads the same. */
export const exists = async (rowPromise: Promise<unknown>): Promise<number> => (await rowPromise) ? 1 : 0;
