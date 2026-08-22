/**
 * Cron work over the inspection records themselves.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, isNull, lte, ne } from 'drizzle-orm';
import { inspections } from '../../lib/db/schema/inspection/core';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { logger } from '../../lib/logger';
import { TICK, db, exists, type CronJob } from '../types';

/**
 * Orders turned into reports per invocation.
 *
 * UNMEASURED. It halves the sweep's own default of 100 on the argument that
 * generating a report is real per-row work rather than a status flip, but
 * nobody has yet read the CPU back from a real deployment. Declared once so the
 * registry's cap and the limit actually passed cannot drift apart.
 */
const REPORT_GENERATION_BATCH = 50;

// 5a-bis. Turn sold service lines into reports for orders whose scheduled
//     start has arrived. Deliberately not at booking: a report that
//     materialises weeks early clutters the order and freezes a template the
//     tenant may still be editing. Latched per inspection, so a re-run is a
//     no-op rather than a re-titling of documents someone has filled in.
export const reportGenerationJob: CronJob = {
    key: 'report-generation',
    label: 'Generate reports for orders whose start has arrived',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    maxBatch: REPORT_GENERATION_BATCH,
    // sweepScheduledReportGeneration()'s own due-query, as a LIMIT 1.
    probe: (env) => exists(
        db(env).select({ id: inspections.id })
            .from(inspections)
            .where(and(
                isNull(inspections.reportsGeneratedAt),
                lte(inspections.scheduledStartMs, new Date()),
                ne(inspections.status, INSPECTION_STATUS.CANCELLED),
            ))
            .limit(1).get(),
    ),
    run: async (env) => {
        const { sweepScheduledReportGeneration } = await import('../../lib/inspection/report-generation');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const generated = await sweepScheduledReportGeneration(drizzle(env.DB) as any, Date.now(), REPORT_GENERATION_BATCH);
        if (generated > 0) logger.info('[cron] generated reports from sold services', { inspections: generated });
        // A full batch may mean more is waiting, but the job is latched per
        // inspection so the next tick simply picks the rest up; there is no
        // position to resume from and nothing is lost by not carrying one.
        return { processed: generated, nextCursor: null };
    },
};
