/**
 * Pay splits — populate once from tenant rules, then never re-derive (#278).
 *
 * The invariant this module exists to protect: **a split row is never
 * recomputed after creation.** Rules populate it; after that only an explicit
 * edit moves it. Recomputing on read means a rule change rewrites history, in
 * money — the tenant who edits "60%" to "55%" would silently restate what
 * people were already paid.
 *
 * Three consequences that look like bugs and are not:
 *   - `populateSplits` is ADDITIVE. A pair that already has a row is skipped,
 *     not overwritten (the partial unique index is the backstop).
 *   - A roster change never re-divides existing rows. The inspector already on
 *     the line keeps their amount; a new one gets a row derived against the
 *     current roster size. That leaves the line stale on purpose —
 *     `refreshSplits` is how a human resolves it and `previewRefresh` is how
 *     they see what it would do first.
 *   - Splits sum to <= the line's effective price, never forced to equal it.
 *     The remainder is company margin; forcing 100% would model a co-op.
 *
 * Splits attach to `inspection_services` lines, tier 2 of the money authority
 * chain. An invoice overriding the ORDER total does not redistribute pay.
 *
 * Internals (reads + arithmetic) live in `./pay-split/core`.
 */
import { and, eq, isNull, gte, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { inspectionServicePaySplits } from '../lib/db/schema';
import type { InspectionServicePaySplit } from '../lib/db/schema';
import { syncInspectionAssignments } from '../lib/db/assignment-links';
import type { AssignmentOpts } from '../lib/db/assignment-links';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import {
    activeLines, allLines, computeGross, eligibleFor, exceedError, linePriceCents,
    loadQuals, loadRules, pickRule, requireSplit, rosterIds, splitsForLines,
} from './pay-split/core';
import type { Db } from './pay-split/core';

export interface RefreshChange {
    splitId: string;
    userId: string;
    inspectionServiceId: string;
    from: number;
    to: number;
}

export interface OrphanSplit {
    split: InspectionServicePaySplit;
    reason: 'inspector_removed' | 'line_inactive';
}

/** Splits on one billing line, oldest first. */
export async function getSplitsForLine(
    db: Db, tenantId: string, inspectionServiceId: string,
): Promise<InspectionServicePaySplit[]> {
    return await splitsForLines(db, tenantId, [inspectionServiceId]);
}

/** Splits across every ACTIVE line of an inspection.
 *
 *  Not exported: its only caller today is `refreshSplits` below. Task 3 gives it
 *  a route and will export it then — `knip-baseline.json` is empty on purpose,
 *  so an export with no consumer outside this module fails `lint:deadcode`
 *  rather than sitting in an allow-list. */
async function getSplitsForInspection(
    db: Db, tenantId: string, inspectionId: string,
): Promise<InspectionServicePaySplit[]> {
    const lines = await activeLines(db, tenantId, inspectionId);
    return await splitsForLines(db, tenantId, lines.map(l => l.id));
}

/**
 * Create the split rows that do not exist yet. Idempotent and additive: an
 * existing (line, user) pair is left exactly as it is, whatever the rules now
 * say.
 *
 * Throws when the derived rows would push a line's splits past its effective
 * price. Validation completes before ANY insert — a partial write here would
 * leave a line half-paid with nothing surfacing it.
 */
export async function populateSplits(db: Db, tenantId: string, inspectionId: string): Promise<number> {
    const lines = await activeLines(db, tenantId, inspectionId);
    if (lines.length === 0) return 0;
    const roster = await rosterIds(db, tenantId, inspectionId);
    if (roster.length === 0) return 0;

    const serviceIds = [...new Set(lines.map(l => l.serviceId))];
    const [rules, quals, existing] = await Promise.all([
        loadRules(db, tenantId, serviceIds),
        loadQuals(db, tenantId, serviceIds),
        splitsForLines(db, tenantId, lines.map(l => l.id)),
    ]);

    const now = new Date();
    const pending: (typeof inspectionServicePaySplits.$inferInsert)[] = [];

    for (const line of lines) {
        const eligible = eligibleFor(line.serviceId, roster, quals);
        if (eligible.length === 0) continue;
        const onLine = existing.filter(s => s.inspectionServiceId === line.id);
        let total = onLine.reduce((sum, s) => sum + s.amountCents, 0);

        for (const userId of eligible) {
            if (onLine.some(s => s.userId === userId && s.correctsSplitId === null)) continue;
            const rule = pickRule(rules, line.serviceId, userId);
            if (!rule) continue;
            // The divisor is the competitor's mandatory, non-disableable rule:
            // a 60% rule on a $500 service with two inspectors pays 30% each.
            // Without it, a second inspector pays out 120% of the service.
            const amountCents = Math.floor(computeGross(rule, line.priceCents) / eligible.length);
            if (amountCents <= 0) continue;
            if (total + amountCents > line.priceCents) throw exceedError(total + amountCents, line.priceCents);
            total += amountCents;
            pending.push({
                id: nanoid(), tenantId, inspectionServiceId: line.id, userId,
                amountCents, source: 'rule', lockedAt: null, correctsSplitId: null,
                reason: null, createdAt: now, updatedAt: now,
            });
        }
    }

    for (const row of pending) await db.insert(inspectionServicePaySplits).values(row).run();
    return pending.length;
}

/** Rows the current roster and line set no longer justify. */
export async function findOrphanSplits(db: Db, tenantId: string, inspectionId: string): Promise<OrphanSplit[]> {
    const lines = await allLines(db, tenantId, inspectionId);
    if (lines.length === 0) return [];
    const inactive = new Set(lines.filter(l => !l.active).map(l => l.id));
    const roster = new Set(await rosterIds(db, tenantId, inspectionId));
    const splits = await splitsForLines(db, tenantId, lines.map(l => l.id));

    const out: OrphanSplit[] = [];
    for (const split of splits) {
        if (inactive.has(split.inspectionServiceId)) out.push({ split, reason: 'line_inactive' });
        else if (!roster.has(split.userId)) out.push({ split, reason: 'inspector_removed' });
    }
    return out;
}

/**
 * Reconcile after a roster or service-line change: drop the rule-derived rows
 * nobody is owed any more, then create the ones now missing.
 *
 * A MANUALLY edited or locked orphan is deliberately left standing. Someone
 * agreed that number, or it has already been paid; deleting it because a
 * roster changed would erase a decision, so it surfaces as an orphan for an
 * admin to resolve instead.
 */
export async function syncSplitsForInspection(
    db: Db, tenantId: string, inspectionId: string,
): Promise<{ removed: number; created: number }> {
    const orphans = await findOrphanSplits(db, tenantId, inspectionId);
    const removable = orphans.filter(o =>
        o.split.source === 'rule' && o.split.lockedAt === null && o.split.correctsSplitId === null);
    for (const o of removable) {
        await db.delete(inspectionServicePaySplits)
            .where(and(
                eq(inspectionServicePaySplits.tenantId, tenantId),
                eq(inspectionServicePaySplits.id, o.split.id),
            ))
            .run();
    }
    const created = await populateSplits(db, tenantId, inspectionId);
    return { removed: removable.length, created };
}

/**
 * The entry point for assignment and service-line writes.
 *
 * Swallows a bad pay rule deliberately: a misconfigured percentage must not
 * make SAVING AN ASSIGNMENT fail. The splits stay stale, the warning is
 * logged, and an explicit refresh resolves it — the same posture orphans get.
 */
export async function syncSplitsQuietly(db: Db, tenantId: string, inspectionId: string): Promise<void> {
    try {
        await syncSplitsForInspection(db, tenantId, inspectionId);
    } catch (err) {
        logger.warn('pay-split sync skipped', {
            tenantId, inspectionId,
            reason: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Record who is assigned AND reconcile what they are owed, in that order.
 *
 * The two move together on purpose: an assignment path that writes the roster
 * without touching splits leaves the money silently attributed to whoever was
 * on the job before. Call this from assignment writes rather than
 * `syncInspectionAssignments` directly, so a new path cannot forget the second
 * half. Bulk importers stay on the bare roster writer — they run before any
 * service line exists, so there is nothing to populate.
 */
export async function syncAssignmentsAndSplits(
    db: Db, tenantId: string, inspectionId: string, opts: AssignmentOpts,
): Promise<void> {
    await syncInspectionAssignments(db, tenantId, inspectionId, opts);
    await syncSplitsQuietly(db, tenantId, inspectionId);
}

/** What `refreshSplits` would change, without changing it. */
export async function previewRefresh(db: Db, tenantId: string, inspectionId: string): Promise<RefreshChange[]> {
    const lines = await activeLines(db, tenantId, inspectionId);
    if (lines.length === 0) return [];
    const roster = await rosterIds(db, tenantId, inspectionId);
    const serviceIds = [...new Set(lines.map(l => l.serviceId))];
    const [rules, quals, existing] = await Promise.all([
        loadRules(db, tenantId, serviceIds),
        loadQuals(db, tenantId, serviceIds),
        splitsForLines(db, tenantId, lines.map(l => l.id)),
    ]);

    const out: RefreshChange[] = [];
    for (const line of lines) {
        const eligible = eligibleFor(line.serviceId, roster, quals);
        if (eligible.length === 0) continue;
        for (const split of existing.filter(s => s.inspectionServiceId === line.id)) {
            // A manual amount is a human decision and a correction is a ledger
            // entry; neither is re-derivable.
            if (split.source !== 'rule' || split.correctsSplitId !== null) continue;
            if (!eligible.includes(split.userId)) continue;
            const rule = pickRule(rules, line.serviceId, split.userId);
            if (!rule) continue;
            const to = Math.floor(computeGross(rule, line.priceCents) / eligible.length);
            if (to !== split.amountCents) {
                out.push({
                    splitId: split.id, userId: split.userId,
                    inspectionServiceId: line.id, from: split.amountCents, to,
                });
            }
        }
    }
    return out;
}

/**
 * Re-derive the rule-sourced splits from the CURRENT rules and roster. This is
 * the only path that moves an existing amount, and it is deliberately
 * explicit: re-deriving four amounts silently is how someone's pay changes
 * without anyone deciding it should, and the person affected is the last to
 * know.
 */
export async function refreshSplits(db: Db, tenantId: string, inspectionId: string): Promise<number> {
    const existing = await getSplitsForInspection(db, tenantId, inspectionId);
    if (existing.some(s => s.lockedAt !== null)) {
        throw Errors.Conflict(
            'This inspection has splits locked by a payroll export. Record a correction instead of refreshing.',
        );
    }
    const changes = await previewRefresh(db, tenantId, inspectionId);
    const now = new Date();
    for (const change of changes) {
        await db.update(inspectionServicePaySplits)
            .set({ amountCents: change.to, updatedAt: now })
            .where(and(
                eq(inspectionServicePaySplits.tenantId, tenantId),
                eq(inspectionServicePaySplits.id, change.splitId),
            ))
            .run();
    }
    await populateSplits(db, tenantId, inspectionId);
    return changes.length;
}

/** Set an agreed amount by hand. Marks the row `manual`, which exempts it from refresh. */
export async function setSplitManually(
    db: Db, tenantId: string, splitId: string, amountCents: number, reason?: string,
): Promise<InspectionServicePaySplit> {
    const split = await requireSplit(db, tenantId, splitId);
    if (split.lockedAt !== null) {
        throw Errors.Conflict('This split is locked by a payroll export. Record a correction instead.');
    }
    const price = await linePriceCents(db, tenantId, split.inspectionServiceId);
    const others = (await getSplitsForLine(db, tenantId, split.inspectionServiceId))
        .filter(s => s.id !== splitId)
        .reduce((sum, s) => sum + s.amountCents, 0);
    if (others + amountCents > price) throw exceedError(others + amountCents, price);
    await db.update(inspectionServicePaySplits)
        .set({ amountCents, source: 'manual', reason: reason ?? split.reason, updatedAt: new Date() })
        .where(and(
            eq(inspectionServicePaySplits.tenantId, tenantId),
            eq(inspectionServicePaySplits.id, splitId),
        ))
        .run();
    return await requireSplit(db, tenantId, splitId);
}

/**
 * Lock every unlocked split created in the period and hand them back as the
 * payroll run. Locking IS the export: once money has moved, an edit would
 * desynchronise the books from what was actually paid, with nothing surfacing
 * the divergence.
 */
export async function exportPayroll(
    db: Db, tenantId: string, period: { fromMs: number; toMs: number },
): Promise<InspectionServicePaySplit[]> {
    const rows = await db.select().from(inspectionServicePaySplits)
        .where(and(
            eq(inspectionServicePaySplits.tenantId, tenantId),
            isNull(inspectionServicePaySplits.lockedAt),
            gte(inspectionServicePaySplits.createdAt, new Date(period.fromMs)),
            lte(inspectionServicePaySplits.createdAt, new Date(period.toMs)),
        ))
        .all();
    const now = new Date();
    for (const row of rows) {
        await db.update(inspectionServicePaySplits)
            .set({ lockedAt: now, updatedAt: now })
            .where(and(
                eq(inspectionServicePaySplits.tenantId, tenantId),
                eq(inspectionServicePaySplits.id, row.id),
            ))
            .run();
    }
    return rows.map(r => ({ ...r, lockedAt: now, updatedAt: now }));
}

/**
 * Adjust an already-exported split by writing a NEW row carrying the delta.
 * The original survives untouched, so "what was paid" and "what was owed" are
 * both still answerable — which an in-place edit destroys.
 */
export async function correctSplit(
    db: Db, tenantId: string, splitId: string, input: { amountCents: number; reason: string },
): Promise<InspectionServicePaySplit> {
    const split = await requireSplit(db, tenantId, splitId);
    if (split.lockedAt === null) {
        throw Errors.BadRequest('This split has not been exported yet — edit it directly instead of correcting it.');
    }
    if (split.correctsSplitId !== null) {
        throw Errors.BadRequest('Corrections are recorded against the original split, not against another correction.');
    }
    const price = await linePriceCents(db, tenantId, split.inspectionServiceId);
    const total = (await getSplitsForLine(db, tenantId, split.inspectionServiceId))
        .reduce((sum, s) => sum + s.amountCents, 0);
    if (total + input.amountCents > price) throw exceedError(total + input.amountCents, price);
    const now = new Date();
    const id = nanoid();
    await db.insert(inspectionServicePaySplits).values({
        id, tenantId, inspectionServiceId: split.inspectionServiceId, userId: split.userId,
        amountCents: input.amountCents, source: 'manual', lockedAt: null,
        correctsSplitId: split.id, reason: input.reason, createdAt: now, updatedAt: now,
    }).run();
    return await requireSplit(db, tenantId, id);
}
