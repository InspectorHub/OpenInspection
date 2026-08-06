/**
 * The write face for `service_pay_rules` — the switch that turns pay splits on
 * (#278).
 *
 * The schema, `populateSplits`, the API for reading splits and the per-inspector
 * metrics all shipped; nothing could create a RULE, and `populateSplits`
 * produces nothing without one (`pickRule` returns undefined, the loop
 * `continue`s, zero rows). This module is the missing half.
 *
 * Extracted from `service.service.ts` the way `./qualification` was, for the
 * same two reasons: the file-size ratchet, and because "what an inspector earns
 * on a catalogue service" is a different concern from what that service costs.
 *
 * Two things here are load-bearing:
 *
 *   - THE UNIT BOUNDARY. `value` is dual-unit (basis points / cents, decided by
 *     `type`). It is translated to and from the per-variant wire names in
 *     exactly these two functions — `toColumns` and `toWire` — and nowhere else,
 *     so there is one place to read when a number looks a hundred times wrong.
 *   - THE 409. Two partial unique indexes refuse a second default rule, and a
 *     second rule for one inspector, at the DB. A raw driver error reaching the
 *     client would be a 500 reading `UNIQUE constraint failed:
 *     service_pay_rules.tenant_id, service_pay_rules.service_id`, which tells
 *     an admin nothing about the screen they are on. The pre-check answers the
 *     ordinary case; the catch is the race backstop, because between the SELECT
 *     and the INSERT another request can land.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { services, servicePayRules, users } from '../../lib/db/schema';
import type { ServicePayRule } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { safeISODate } from '../../lib/date';
import type { z } from 'zod';
import type { CreatePayRuleSchema, UpdatePayRuleSchema } from '../../lib/validations/service.schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type CreatePayRuleInput = z.infer<typeof CreatePayRuleSchema>;
export type UpdatePayRuleInput = z.infer<typeof UpdatePayRuleSchema>;

export interface PayRuleWire {
    id: string;
    serviceId: string;
    userId: string | null;
    type: ServicePayRule['type'];
    percentBps: number | null;
    amountCents: number | null;
    deductionCents: number | null;
    createdAt: string | null;
}

/**
 * Wire shape → the dual-unit column. The ONLY place a percentage becomes
 * `value`, and the only place cents does.
 *
 * The schema's cross-field refinement already guarantees the field each type
 * needs is present, so `need` re-asserts rather than re-validates — but it DOES
 * re-assert, with a throw and not a `!`. The refinement lives in another file,
 * and the failure being guarded is "the money column silently took undefined".
 */
function toColumns(input: CreatePayRuleInput | UpdatePayRuleInput): {
    type: ServicePayRule['type']; value: number; deductionCents: number | null;
} {
    const need = (n: number | undefined, field: string): number => {
        if (n === undefined) throw Errors.BadRequest(`${field} is required when type is "${input.type}".`);
        return n;
    };
    if (input.type === 'fixed') {
        return { type: 'fixed', value: need(input.amountCents, 'amountCents'), deductionCents: null };
    }
    if (input.type === 'percent_after_deduction') {
        return {
            type: 'percent_after_deduction',
            value: need(input.percentBps, 'percentBps'),
            deductionCents: need(input.deductionCents, 'deductionCents'),
        };
    }
    // A `percent` rule must carry NO deduction, including when it replaces a
    // percent_after_deduction rule: a stale value left in the column would keep
    // coming off the top and the arithmetic would quietly disagree with the type.
    return { type: 'percent', value: need(input.percentBps, 'percentBps'), deductionCents: null };
}

/** The column → wire shape. `value` is never echoed under its own name. */
function toWire(row: ServicePayRule): PayRuleWire {
    return {
        id: row.id,
        serviceId: row.serviceId,
        userId: row.userId,
        type: row.type,
        percentBps: row.type === 'fixed' ? null : row.value,
        amountCents: row.type === 'fixed' ? row.value : null,
        deductionCents: row.deductionCents,
        createdAt: row.createdAt ? safeISODate(row.createdAt) : null,
    };
}

/** Ordering the UI can rely on: the service default first, then inspectors by id. */
function ordered(rows: ServicePayRule[]): ServicePayRule[] {
    return [...rows].sort((a, b) =>
        (a.userId === null ? 0 : 1) - (b.userId === null ? 0 : 1)
        || (a.userId ?? '').localeCompare(b.userId ?? ''));
}

async function requireService(db: Db, tenantId: string, serviceId: string): Promise<void> {
    const svc = await db.select({ id: services.id }).from(services)
        .where(and(eq(services.id, serviceId), eq(services.tenantId, tenantId)))
        .limit(1).get();
    if (!svc) throw Errors.NotFound('Service not found');
}

/**
 * A rule may only name a real, non-deleted, non-agent member of this tenant —
 * the same eligibility `setServiceInspectors` enforces. A rule pointing at a
 * stranger's id is unreachable (`pickRule` never matches it) and a rule pointing
 * at an AGENT would try to pay a third-party realtor out of inspection revenue.
 */
async function requireMember(db: Db, tenantId: string, userId: string): Promise<void> {
    const member = await db.select({ id: users.id }).from(users)
        .where(and(
            eq(users.tenantId, tenantId),
            eq(users.id, userId),
            isNull(users.deletedAt),
            ne(users.role, 'agent'),
        ))
        .limit(1).get();
    if (!member) throw Errors.BadRequest(`Invalid or ineligible user ID: ${userId}`);
}

function duplicateError(userId: string | null) {
    return Errors.Conflict(
        userId === null
            ? 'This service already has a default pay rule. Edit that rule instead of adding a second one.'
            : `This service already has a pay rule for that inspector (${userId}). Edit it instead of adding a second one.`,
    );
}

/** True when the driver refused the write on one of the two partial uniques. */
function isUniqueViolation(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /UNIQUE constraint failed/i.test(msg) && /service_pay_rules/i.test(msg);
}

export async function listPayRules(db: Db, tenantId: string, serviceId: string): Promise<PayRuleWire[]> {
    await requireService(db, tenantId, serviceId);
    const rows = await db.select().from(servicePayRules)
        .where(and(eq(servicePayRules.tenantId, tenantId), eq(servicePayRules.serviceId, serviceId)))
        .all();
    return ordered(rows as ServicePayRule[]).map(toWire);
}

export async function createPayRule(
    db: Db, tenantId: string, serviceId: string, input: CreatePayRuleInput,
): Promise<PayRuleWire> {
    await requireService(db, tenantId, serviceId);
    const userId = input.userId ?? null;
    if (userId !== null) await requireMember(db, tenantId, userId);

    // The ordinary duplicate, answered before the driver sees it.
    const clash = (await db.select().from(servicePayRules)
        .where(and(eq(servicePayRules.tenantId, tenantId), eq(servicePayRules.serviceId, serviceId)))
        .all() as ServicePayRule[])
        .some(r => r.userId === userId);
    if (clash) throw duplicateError(userId);

    const id = nanoid();
    const cols = toColumns(input);
    try {
        await db.insert(servicePayRules).values({
            id, tenantId, serviceId, userId, ...cols, createdAt: new Date(),
        }).run();
    } catch (err) {
        // The race: another request wrote the same slot between the SELECT and
        // here. Same answer, so the client cannot tell the two apart — which is
        // correct, because the state it should act on is identical.
        if (isUniqueViolation(err)) throw duplicateError(userId);
        throw err;
    }
    return await requirePayRule(db, tenantId, serviceId, id);
}

export async function updatePayRule(
    db: Db, tenantId: string, serviceId: string, ruleId: string, input: UpdatePayRuleInput,
): Promise<PayRuleWire> {
    await requirePayRule(db, tenantId, serviceId, ruleId);
    await db.update(servicePayRules)
        .set(toColumns(input))
        .where(and(
            eq(servicePayRules.tenantId, tenantId),
            eq(servicePayRules.serviceId, serviceId),
            eq(servicePayRules.id, ruleId),
        ))
        .run();
    return await requirePayRule(db, tenantId, serviceId, ruleId);
}

/**
 * Deleting the last rule for a service turns pay splits back OFF for it:
 * `populateSplits` finds nothing and writes nothing. Splits ALREADY recorded
 * are untouched — they are a record, not a derivation, and rewriting history
 * because a rule changed is the failure the whole feature is built against.
 */
export async function deletePayRule(
    db: Db, tenantId: string, serviceId: string, ruleId: string,
): Promise<void> {
    await requirePayRule(db, tenantId, serviceId, ruleId);
    await db.delete(servicePayRules)
        .where(and(
            eq(servicePayRules.tenantId, tenantId),
            eq(servicePayRules.serviceId, serviceId),
            eq(servicePayRules.id, ruleId),
        ))
        .run();
}

async function requirePayRule(
    db: Db, tenantId: string, serviceId: string, ruleId: string,
): Promise<PayRuleWire> {
    const row = await db.select().from(servicePayRules)
        .where(and(
            eq(servicePayRules.tenantId, tenantId),
            eq(servicePayRules.serviceId, serviceId),
            eq(servicePayRules.id, ruleId),
        ))
        .limit(1).get();
    if (!row) throw Errors.NotFound('Pay rule not found');
    return toWire(row as ServicePayRule);
}
