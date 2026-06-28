/**
 * Shared persistence for Settings "Test connection" outcomes.
 *
 * Every on-demand provider probe (SMS / email / Stripe / Gemini) funnels its
 * result through `recordIntegrationTest` — a single write point so no endpoint
 * duplicates the insert+prune logic. We keep only the newest `KEEP_PER_TARGET`
 * rows per (tenant, target) so the table stays bounded while still backing a
 * short "recent tests" history in the UI.
 *
 * `detail` MUST stay non-sensitive (a success blurb or the provider's rejection
 * message) — never a key, token, or raw response body.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { integrationTestResults } from './db/schema';

type Db = ReturnType<typeof drizzle>;

export type IntegrationTarget = 'sms' | 'email' | 'stripe' | 'gemini';

/** How many recent results to retain per (tenant, target). */
export const KEEP_PER_TARGET = 5;

export interface IntegrationTestResult {
    target: IntegrationTarget;
    provider: string | null;
    ok: boolean;
    detail: string | null;
    testedByUserId: string | null;
    testedAt: number; // epoch ms
}

export interface RecordTestArgs {
    tenantId: string;
    target: IntegrationTarget;
    ok: boolean;
    provider?: string | null;
    detail?: string | null;
    testedByUserId?: string | null;
    /** Injectable for tests; defaults to wall-clock. */
    nowMs?: number;
}

/**
 * Pure prune decision: given ids ordered newest→oldest, return the ids to
 * delete so only `keep` remain. Extracted so the bounded-history invariant is
 * unit-testable without a database.
 */
export function idsToPrune(idsNewestFirst: string[], keep: number): string[] {
    return idsNewestFirst.slice(Math.max(keep, 0));
}

/** Trim a provider message to a safe length for the detail column. */
function clampDetail(detail: string | null | undefined): string | null {
    if (!detail) return null;
    const trimmed = detail.trim();
    if (!trimmed) return null;
    return trimmed.length > 300 ? `${trimmed.slice(0, 297)}…` : trimmed;
}

/**
 * Append one test result and prune older rows for the same (tenant, target).
 * Best-effort and self-contained: callers should not let a logging failure
 * break the probe response, so wrap in `.catch()` at the call site if needed.
 */
export async function recordIntegrationTest(db: Db, args: RecordTestArgs): Promise<void> {
    const testedAt = args.nowMs ?? Date.now();
    await db.insert(integrationTestResults).values({
        id: crypto.randomUUID(),
        tenantId: args.tenantId,
        target: args.target,
        provider: args.provider ?? null,
        ok: args.ok,
        detail: clampDetail(args.detail),
        testedByUserId: args.testedByUserId ?? null,
        testedAt: new Date(testedAt),
    });

    // Prune to the newest KEEP_PER_TARGET for this (tenant, target).
    const rows = await db
        .select({ id: integrationTestResults.id })
        .from(integrationTestResults)
        .where(and(
            eq(integrationTestResults.tenantId, args.tenantId),
            eq(integrationTestResults.target, args.target),
        ))
        .orderBy(desc(integrationTestResults.testedAt))
        .all();
    const stale = idsToPrune(rows.map((r) => r.id), KEEP_PER_TARGET);
    if (stale.length > 0) {
        await db.delete(integrationTestResults).where(inArray(integrationTestResults.id, stale));
    }
}

/**
 * Read all retained test results for a tenant (≤ KEEP_PER_TARGET per target,
 * so ≤ 4 × KEEP_PER_TARGET rows total), newest first. The settings loaders pass
 * this straight to the shared <ConnectionTestStatus> component, which picks the
 * latest per target and renders the rest as recent history.
 */
export async function listIntegrationTestResults(db: Db, tenantId: string): Promise<IntegrationTestResult[]> {
    const rows = await db
        .select()
        .from(integrationTestResults)
        .where(eq(integrationTestResults.tenantId, tenantId))
        .orderBy(desc(integrationTestResults.testedAt))
        .all();
    return rows.map((r) => ({
        target: r.target as IntegrationTarget,
        provider: r.provider,
        ok: r.ok,
        detail: r.detail,
        testedByUserId: r.testedByUserId,
        testedAt: r.testedAt instanceof Date ? r.testedAt.getTime() : Number(r.testedAt),
    }));
}
