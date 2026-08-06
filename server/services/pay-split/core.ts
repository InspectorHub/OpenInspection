/**
 * Pay-split internals — the reads and the arithmetic, shared by every public
 * operation in `pay-split.service.ts`.
 *
 * Extracted to keep that file under the size ratchet, and the seam is a real
 * one: everything here is a pure derivation or a scoped read, and nothing here
 * writes. The invariants that make pay splits correct (populate once, never
 * re-derive, sum to <= the line price) live with the operations that enforce
 * them, not here.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
    inspectionServices,
    serviceInspectors,
    servicePayRules,
    inspectionServicePaySplits,
} from '../../lib/db/schema';
import type { ServicePayRule, InspectionServicePaySplit } from '../../lib/db/schema';
import { getInspectionRoster } from '../../lib/inspection/roster';
import { Errors } from '../../lib/errors';

export type Db = DrizzleD1Database;

export interface Line {
    id: string;
    serviceId: string;
    /** Effective line price — tier 2 of the money chain: `priceOverride ?? priceSnapshot`. */
    priceCents: number;
}

/**
 * The lines a split may attach to.
 *
 * Filters `is_active`, which is not optional: that column's own comment says
 * every reader must filter on it and names pay splits as the reason it exists.
 * A line declined at the door stays in the table because a report or a split
 * may already point at it — paying against it anyway is the failure this
 * filter prevents.
 */
export async function activeLines(db: Db, tenantId: string, inspectionId: string): Promise<Line[]> {
    const rows = await db.select({
        id: inspectionServices.id,
        serviceId: inspectionServices.serviceId,
        priceOverride: inspectionServices.priceOverride,
        priceSnapshot: inspectionServices.priceSnapshot,
    })
        .from(inspectionServices)
        .where(and(
            eq(inspectionServices.tenantId, tenantId),
            eq(inspectionServices.inspectionId, inspectionId),
            eq(inspectionServices.active, true),
        ))
        .all();
    return rows.map(r => ({ id: r.id, serviceId: r.serviceId, priceCents: r.priceOverride ?? r.priceSnapshot }));
}

/** Every line of an inspection, active or not — the orphan scan needs both. */
export async function allLines(db: Db, tenantId: string, inspectionId: string) {
    return await db.select({ id: inspectionServices.id, active: inspectionServices.active })
        .from(inspectionServices)
        .where(and(
            eq(inspectionServices.tenantId, tenantId),
            eq(inspectionServices.inspectionId, inspectionId),
        ))
        .all();
}

/**
 * Roster user ids, lead first. Read through `getInspectionRoster` only — never
 * `inspections.inspector_id`, which is how "who worked this" acquired two
 * disagreeing answers. Note the member key is `id`, not `userId`.
 */
export async function rosterIds(db: Db, tenantId: string, inspectionId: string): Promise<string[]> {
    const roster = await getInspectionRoster(db, tenantId, inspectionId);
    return [...(roster.lead ? [roster.lead.id] : []), ...roster.helpers.map(h => h.id)];
}

/**
 * Who may be paid on this line. ZERO qualification rows for a service means
 * every staff member is qualified (the `service_inspectors` MVP default);
 * rows restrict it. Mirrors the competitor's auto-assign, which pays every
 * inspector on the job for the services they are not excluded from.
 */
export function eligibleFor(serviceId: string, roster: string[], quals: Map<string, Set<string>>): string[] {
    const restricted = quals.get(serviceId);
    if (!restricted || restricted.size === 0) return roster;
    return roster.filter(u => restricted.has(u));
}

/** Gross amount for ONE line, before the per-inspector divide. */
export function computeGross(rule: ServicePayRule, priceCents: number): number {
    if (rule.type === 'fixed') return rule.value;
    // The deduction comes out BEFORE the percentage, which is why this is its
    // own type rather than a smaller percentage of the gross.
    const base = rule.type === 'percent_after_deduction'
        ? Math.max(0, priceCents - (rule.deductionCents ?? 0))
        : priceCents;
    return Math.floor((base * rule.value) / 10000);
}

/** A rule written for this inspector wins over the service default (`user_id IS NULL`). */
export function pickRule(rules: ServicePayRule[], serviceId: string, userId: string): ServicePayRule | undefined {
    return rules.find(r => r.serviceId === serviceId && r.userId === userId)
        ?? rules.find(r => r.serviceId === serviceId && r.userId === null);
}

export async function loadQuals(db: Db, tenantId: string, serviceIds: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (serviceIds.length === 0) return out;
    const rows = await db.select().from(serviceInspectors)
        .where(and(eq(serviceInspectors.tenantId, tenantId), inArray(serviceInspectors.serviceId, serviceIds)))
        .all();
    for (const r of rows) {
        const set = out.get(r.serviceId) ?? new Set<string>();
        set.add(r.userId);
        out.set(r.serviceId, set);
    }
    return out;
}

export async function loadRules(db: Db, tenantId: string, serviceIds: string[]): Promise<ServicePayRule[]> {
    if (serviceIds.length === 0) return [];
    return await db.select().from(servicePayRules)
        .where(and(eq(servicePayRules.tenantId, tenantId), inArray(servicePayRules.serviceId, serviceIds)))
        .all();
}

export async function splitsForLines(
    db: Db, tenantId: string, lineIds: string[],
): Promise<InspectionServicePaySplit[]> {
    if (lineIds.length === 0) return [];
    const rows = await db.select().from(inspectionServicePaySplits)
        .where(and(
            eq(inspectionServicePaySplits.tenantId, tenantId),
            inArray(inspectionServicePaySplits.inspectionServiceId, lineIds),
        ))
        .all();
    // Deterministic order: the original before the corrections written against it.
    return rows.sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || a.id.localeCompare(b.id));
}

export async function requireSplit(db: Db, tenantId: string, splitId: string): Promise<InspectionServicePaySplit> {
    const row = await db.select().from(inspectionServicePaySplits)
        .where(and(
            eq(inspectionServicePaySplits.tenantId, tenantId),
            eq(inspectionServicePaySplits.id, splitId),
        ))
        .limit(1).get();
    if (!row) throw Errors.NotFound('Pay split not found');
    return row;
}

export async function linePriceCents(db: Db, tenantId: string, lineId: string): Promise<number> {
    const line = await db.select({
        priceOverride: inspectionServices.priceOverride,
        priceSnapshot: inspectionServices.priceSnapshot,
    })
        .from(inspectionServices)
        .where(and(eq(inspectionServices.tenantId, tenantId), eq(inspectionServices.id, lineId)))
        .limit(1).get();
    if (!line) throw Errors.NotFound('Service line not found');
    return line.priceOverride ?? line.priceSnapshot;
}

/** One message, one shape — the exceed guard is asserted by name in the tests. */
export function exceedError(total: number, priceCents: number) {
    return Errors.BadRequest(
        `Pay splits would exceed the line price (${total} > ${priceCents} cents). `
        + 'Adjust the pay rule or the agreed amount for this service.',
    );
}
