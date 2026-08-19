import { drizzle } from 'drizzle-orm/d1';
import { and, asc, eq } from 'drizzle-orm';
import {
    migrationBatches,
    migrationRows,
    type MigrationConflictPolicy,
    type MigrationIntent,
} from '../../lib/db/schema';
import { MIGRATION_ROW_STATUS } from '../../lib/status/migration-row-status';
import type { MigrationBatchStatus } from '../../lib/status/migration-batch-status';
import { describeRowProblem } from '../../lib/migration-intake/row-problems';
import type { EntityKind } from '../../lib/migration-intake/bundle';
import { getSeatUsage } from '../../features/seat-quota/usage';
import { computeSeatsNeeded } from '../../features/seat-quota/batch';
import { Errors } from '../../lib/errors';

/** One entry that needs a person before the run can go ahead. */
export interface BatchReportProblemRow {
    rowId: string;
    entity: EntityKind;
    /** Index within this entity family — how the operator finds it in their own file. */
    position: number;
    field?: string;
    reason: string;
    value?: string;
    suggestion?: string;
}

export interface BatchReport {
    batch: {
        id: string;
        intent: MigrationIntent;
        vendor: string;
        status: MigrationBatchStatus;
        conflictPolicy: MigrationConflictPolicy | null;
        createdAt: Date;
    };
    /**
     * The three buckets, plus the total they must add up to.
     *
     * Printed side by side and asserted, because a view that shows only the
     * problems cannot tell "nothing is wrong" from "nothing was examined".
     */
    counts: { total: number; ok: number; conflicts: number; problems: number };
    /** Only the entries needing a person, and only this page of them. */
    problemRows: BatchReportProblemRow[];
    /** How many there are behind the page. Without it a page of three is unreadable. */
    problemRowsTotal: number;
    page: number;
    pageSize: number;
    /**
     * Why apply is unavailable, or null when it is available.
     *
     * A sentence, not a boolean, and it names the FIRST thing to fix reading
     * down the run. Computed here rather than on the screen so a banner and a
     * button can never disagree about whether the run is ready.
     */
    blockedReason: string | null;
}

export interface BuildReportParams {
    tenantId: string;
    batchId: string;
    page?: number | undefined;
    pageSize?: number | undefined;
    /** `profile.hasSeatQuota`. False removes the seat sentence entirely. */
    seatQuotaEnforced: boolean;
}

type StagedRow = typeof migrationRows.$inferSelect;

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Counted things, so a sentence about one entry does not read as a bug. */
function entries(n: number): string {
    return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

/**
 * Reads a staged run and says what a person still has to do with it.
 *
 * Derived from the rows every time rather than stored: a repaired row has to
 * move out of `problems` on the next read, and a stored summary would need a
 * second thing to remember to update.
 */
export class MigrationReportService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async build(params: BuildReportParams): Promise<BatchReport> {
        const db = this.getDrizzle();

        const batch = await db.select().from(migrationBatches)
            .where(and(eq(migrationBatches.id, params.batchId), eq(migrationBatches.tenantId, params.tenantId)))
            .get();
        if (!batch) throw Errors.NotFound('Migration batch not found');

        const rows = await db.select().from(migrationRows)
            .where(and(
                eq(migrationRows.batchId, params.batchId),
                eq(migrationRows.tenantId, params.tenantId),
            ))
            .orderBy(asc(migrationRows.entity), asc(migrationRows.position))
            .all();

        const { problems, conflicts, ok } = this.sortIntoBuckets(rows);
        const counts = { total: rows.length, ok, conflicts, problems: problems.length };

        const page = Math.max(1, params.page ?? 1);
        const pageSize = Math.min(Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
        const start = (page - 1) * pageSize;

        return {
            batch: {
                id: batch.id,
                intent: batch.intent,
                vendor: batch.vendor,
                status: batch.status,
                conflictPolicy: batch.conflictPolicy,
                createdAt: batch.createdAt,
            },
            counts,
            problemRows: problems.slice(start, start + pageSize),
            problemRowsTotal: problems.length,
            page,
            pageSize,
            blockedReason: await this.blockedReason(params, batch, rows, counts),
        };
    }

    /**
     * Every row into exactly one bucket.
     *
     * Problems win over clashes. Whether a row can be written at all is
     * unsettled, so asking "overwrite or skip" about it is asking about
     * something that may never happen — repaired, it turns up under conflicts
     * on the next read, because this is recomputed rather than remembered.
     */
    private sortIntoBuckets(rows: StagedRow[]): {
        problems: BatchReportProblemRow[];
        conflicts: number;
        ok: number;
    } {
        const problems: BatchReportProblemRow[] = [];
        let conflicts = 0;
        let ok = 0;

        for (const row of rows) {
            if (row.status !== MIGRATION_ROW_STATUS.PENDING) {
                // A row that has already been consumed is neither a question
                // nor a clash — it is history, and it belongs to `ok` so the
                // equation still closes over the whole run.
                ok++;
                continue;
            }
            const payload: unknown = JSON.parse(row.payload);
            const problem = describeRowProblem(row.entity, payload);
            if (problem) {
                problems.push({
                    rowId: row.id,
                    entity: row.entity,
                    position: row.position,
                    ...(problem.field === undefined ? {} : { field: problem.field }),
                    reason: problem.reason,
                    ...(problem.value === undefined ? {} : { value: problem.value }),
                    ...(problem.suggestion === undefined ? {} : { suggestion: problem.suggestion }),
                });
                continue;
            }
            if (row.conflictWith) {
                conflicts++;
                continue;
            }
            ok++;
        }

        return { problems, conflicts, ok };
    }

    /**
     * The first thing standing in the way, reading down the run.
     *
     * Order is the rule, not a preference: telling somebody they need three
     * more seats while twelve rows cannot be written at all sends them to buy
     * capacity for entries that were never going to be created.
     *
     * The seat sentence is word-for-word the one the apply path refuses with,
     * so the banner and the refusal cannot state different numbers.
     */
    private async blockedReason(
        params: BuildReportParams,
        batch: typeof migrationBatches.$inferSelect,
        rows: StagedRow[],
        counts: { problems: number },
    ): Promise<string | null> {
        if (counts.problems > 0) {
            return `${entries(counts.problems)} cannot be imported as written. `
                + `Fix ${counts.problems === 1 ? 'it' : 'them'} below.`;
        }

        const pending = rows.filter((r) => r.status === MIGRATION_ROW_STATUS.PENDING);
        // Nothing left to consume is not a blocked run, it is a finished one.
        // Without this, an applied overwrite batch would report that it carries
        // 0 templates and needs exactly 1 — a complaint about a run that has
        // already done what it was for.
        if (pending.length === 0) return null;

        const needed = computeSeatsNeeded(pending);
        if (params.seatQuotaEnforced && needed > 0) {
            const usage = await getSeatUsage(params.tenantId, this.db);
            if (usage.max !== null && needed > usage.remaining) {
                return `This import needs ${needed} seats and ${usage.remaining} are available. `
                    + 'Upgrade your plan, or import fewer people.';
            }
        }

        if (batch.intent === 'templates.overwrite') {
            const templateRows = pending.filter((r) => r.entity === 'template').length;
            if (templateRows !== 1) {
                return `This import carries ${templateRows} templates and an overwrite accepts exactly 1. `
                    + 'To bring them all in, start from the Templates list instead.';
            }
        }

        return null;
    }
}
