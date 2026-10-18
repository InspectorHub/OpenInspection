// @vitest-environment node
/**
 * The /inspections loader reads only what the page renders.
 *
 * The New Inspection wizard is its own route (/inspections/new) with its own
 * loader, so the template, service and member lists this loader used to fetch
 * were never read. What the dashboard needs: the buckets, the tag filter, the
 * caller's onboarding state, and the usage banner. The onboarding checklist's
 * extra inputs (schedule, template and service counts) are read only while the
 * checklist is still showing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const seam = vi.hoisted(() => ({
    calls: [] as string[],
    dismissed: false,
    hang: false,
}));
const templateQueries: unknown[] = [];

const json = (data: unknown, extra: Record<string, unknown> = {}) =>
    Promise.resolve({ ok: true, json: async () => ({ data, ...extra }) });
const rec = (name: string, fn: () => Promise<unknown>) => (..._args: unknown[]) => {
    seam.calls.push(name);
    return fn();
};

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        inspections: {
            dashboard: { $get: rec("dashboard", () => json({ today: [], conciergePending: 0 })) },
            templates: { $get: (args: { query?: unknown }) => { templateQueries.push(args?.query); return rec("templates", () => json([{ id: "t1", name: "T", itemCount: 3 }], { meta: { total: 7 } }))(); } },
            index: { $post: vi.fn() },
        },
        tags: { index: { $get: rec("tags", () => json([{ id: "g1", name: "Rush", color: "#fff" }])) } },
        services: { index: { $get: rec("services", () => json([{ id: "s1", name: "S", price: 1 }, { id: "s2", name: "S2", price: 2 }])) } },
        auth: {
            me: { $get: rec("me", () => json({ user: { onboardingState: seam.dismissed ? { checklistDismissed: true } : null } })) },
        },
        admin: { members: { $get: rec("members", () => json([])) } },
        usage: { summary: { $get: rec("usage", () => json({ caps: null, usage: {} })) } },
        availability: { index: { $get: rec("availability", () => (seam.hang ? new Promise(() => {}) : json([{ id: "a" }]))) } },
        calendar: { status: { $get: rec("calendarStatus", () => json({ connected: false })) } },
    }),
}));

import { loader } from "~/routes/inspections";
import { routeArgs } from "../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof loader>[0]["context"];
const run = () => loader(routeArgs(new Request("http://localhost/inspections"), { context: CONTEXT, params: {} }) as never);

beforeEach(() => {
    seam.calls.length = 0;
    templateQueries.length = 0;
    seam.dismissed = false;
    seam.hang = false;
});
afterEach(() => vi.useRealTimers());

describe("/inspections loader", () => {
    it("reads the dashboard inputs and the checklist counts, and none of the wizard's lists", async () => {
        const out = await run() as { templateCount: number; serviceCount: number; scheduleSet: boolean; tags: unknown[] };
        expect(new Set(seam.calls)).toEqual(new Set(["dashboard", "tags", "me", "usage", "templates", "services", "availability", "calendarStatus"]));
        expect(seam.calls).toHaveLength(8);
        expect(seam.calls).not.toContain("members");
        // One template row is enough to count; the full 100-row list is not fetched.
        expect(templateQueries).toEqual([{ page: "1", pageSize: "1" }]);
        expect(out.templateCount).toBe(7);
        expect(out.serviceCount).toBe(2);
        expect(out.scheduleSet).toBe(true);
        expect(out.tags).toHaveLength(1);
        // The wizard route loads these for itself; this payload no longer carries them.
        for (const key of ["templates", "services", "teamMembers"]) expect(out).not.toHaveProperty(key);
    });

    it("a dismissed checklist is reported as dismissed and still gets its counts", async () => {
        seam.dismissed = true;
        const out = await run() as { checklistDismissed: boolean; templateCount: number };
        expect(out.checklistDismissed).toBe(true);
        expect(out.templateCount).toBe(7);
    });

    it("returns even when a checklist input never settles", async () => {
        vi.useFakeTimers();
        seam.hang = true;
        const pending = run();
        await vi.advanceTimersByTimeAsync(10_000);
        const out = await pending as { loadFailed: boolean; scheduleSet: boolean; buckets: unknown };
        expect(out.loadFailed).toBe(false);
        expect(out.scheduleSet).toBe(false);
        expect(out.buckets).toBeTruthy();
    });
});
