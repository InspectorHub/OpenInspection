/**
 * One inspection, one row.
 *
 * The dashboard payload sorts inspections into buckets that OVERLAP by design —
 * an inspection completed today is both "scheduled for today" and a "recent
 * report", and the stat cards read those two counts as two different lenses on
 * the workspace. The LIST cannot: rendering every bucket showed the same
 * inspection twice, with its own checkbox each time, and the row that appeared
 * under "Scheduled for today" carried a `completed` badge — the group name and
 * the status contradicting each other in the same line.
 *
 * So the list picks one bucket per inspection. The order below is what to say
 * about an inspection when several things are true at once: something needing
 * attention is worth surfacing over its date, work that is finished is a report
 * rather than a plan, and a cancelled visit is last because it is not work.
 */
import type { Inspection, Tag, TemplateOption, ServiceOption } from "~/lib/dashboard-schema";
import type { WizardTeamMember } from "~/components/NewInspectionWizard";
import { m } from "~/paraglide/messages";

export const BUCKET_PRIORITY = [
    "needsAttention",
    "recentReports",
    "today",
    "thisWeek",
    "later",
    "cancelled",
] as const;

/**
 * Drop each inspection from every bucket but its highest-priority one, keeping
 * the caller's own key order for rendering. Buckets left empty are removed, so a
 * group never renders as a heading above nothing.
 *
 * Buckets not named in `priority` keep their contents (they are simply never
 * preferred), which is how an unknown bucket added by the API later shows up at
 * all instead of vanishing.
 */
export function dedupeBucketMembership<T extends { id: string }>(
    buckets: Record<string, T[]>,
    priority: readonly string[] = BUCKET_PRIORITY,
): Record<string, T[]> {
    const owner = new Map<string, string>();
    const rank = (key: string) => {
        const i = priority.indexOf(key);
        return i === -1 ? priority.length : i;
    };
    for (const [key, items] of Object.entries(buckets)) {
        for (const item of items) {
            const current = owner.get(item.id);
            if (current === undefined || rank(key) < rank(current)) owner.set(item.id, key);
        }
    }
    const out: Record<string, T[]> = {};
    for (const [key, items] of Object.entries(buckets)) {
        const kept = items.filter((item) => owner.get(item.id) === key);
        if (kept.length > 0) out[key] = kept;
    }
    return out;
}

/**
 * The dashboard payload as it looks with nothing in it — the loader's fail-closed
 * fallback. One source for it keeps the bucket shape identical to the success
 * path, and it lives beside `BUCKET_PRIORITY` because the two are the same list
 * seen twice: every bucket named here needs a rank there.
 */
/**
 * The "nothing here" dashboard shape.
 *
 * IA-118 — this doubles as the loader's catch fallback, so `loadFailed` is a
 * parameter rather than a constant: an operator's whole workload showing as
 * empty is a claim, and it must not be made because a request failed.
 */
export function emptyDashboard(loadFailed = false) {
    return {
        loadFailed,
        buckets: {
            needsAttention: [] as Inspection[],
            today: [] as Inspection[],
            thisWeek: [] as Inspection[],
            later: [] as Inspection[],
            recentReports: [] as Inspection[],
            cancelled: [] as Inspection[],
        },
        conciergePending: 0,
        greeting: m.inspections_list_greeting_morning(),
        tags: [] as Tag[],
        templates: [] as TemplateOption[],
        services: [] as ServiceOption[],
        teamMembers: [] as WizardTeamMember[],
        checklistDismissed: false,
        templateCount: 0,
        serviceCount: 0,
        scheduleSet: false,
        quotaCaps: null as { inspections: number; sms: number; email: number } | null,
        quotaUsage: null as { inspections: number; sms: number; email: number } | null,
    };
}
