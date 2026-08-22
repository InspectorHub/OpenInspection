/**
 * The statutory-form revision watch.
 *
 * ── What it does, and the thing it is forbidden to do ───────────────────────
 * Once a day it fetches each authority page this deployment publishes a form
 * from, hashes what it gets, and writes a sighting row. It never publishes a
 * revision, and it never edits one: a watcher that only reports costs nothing
 * on the day it misses a change, while one that replaces sends an inspector a
 * statutory form the state did not ask for, which they sign and file with it.
 *
 * ── Why it is free on almost every deployment ───────────────────────────────
 * The targets come from the published catalogue, which is empty in this
 * repository (`server/lib/statutory/forms/index.ts` says so, by declaration).
 * So `probe` returns 0 and the job never reaches an invocation — that is an
 * array length, not a query, which is what keeps an idle tick honest about its
 * CPU cost on the Workers Free ceiling.
 */
import { PUBLISHED_FORM_VERSIONS } from '../../lib/statutory/forms';
import { watchTargets } from '../../lib/statutory/revision-watch';
import { DAILY_04, type CronJob } from '../types';

export const statutoryRevisionWatchJob: CronJob = {
    key: 'statutory-revision-watch',
    label: 'Notice when an authority changes a statutory form (never adopt it)',
    trigger: DAILY_04,
    // Both: a standalone operator who publishes a state form needs to hear that
    // the state changed it every bit as much as a hosted one does.
    modes: ['standalone', 'saas'],
    // One page per invocation. These are somebody else's servers and a slow one
    // must not spend a neighbour's budget; the cursor carries the rest to the
    // next invocation rather than the next day.
    maxBatch: 1,
    probe: async () => watchTargets(PUBLISHED_FORM_VERSIONS).length,
    run: async (env, cursor) => {
        const targets = watchTargets(PUBLISHED_FORM_VERSIONS);
        // The cursor is a position in a list derived from the catalogue, so a
        // catalogue that changed between invocations can leave it past the end.
        // That is a completed sweep, not an error: the next run starts over.
        const start = Number(cursor ?? '0');
        const from = Number.isInteger(start) && start > 0 ? start : 0;
        const batch = targets.slice(from, from + 1);
        if (batch.length === 0) return { processed: 0, nextCursor: null };

        const { StatutoryRevisionWatchService } = await import(
            '../../services/statutory/revision-watch.service'
        );
        const watch = new StatutoryRevisionWatchService(env.DB);
        const now = new Date();
        for (const target of batch) await watch.poll(target, now);

        const next = from + batch.length;
        return { processed: batch.length, nextCursor: next < targets.length ? String(next) : null };
    },
};
