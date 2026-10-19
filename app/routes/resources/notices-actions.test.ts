// @vitest-environment node
/**
 * The notices bell's writes (mark all read, dismiss) answer `ok: true` only when
 * the API accepted them. They used to answer ok whatever the API said, because
 * the response was never looked at, so a refused dismiss looked like a success.
 */
import { describe, it, expect, vi } from "vitest";

const seam = vi.hoisted(() => ({ status: 200 }));
vi.mock("~/lib/session.server", () => ({ getToken: vi.fn().mockResolvedValue("tok") }));
const answer = async () => ({ ok: seam.status < 300, status: seam.status, json: async () => ({}) });
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        notifications: { "mark-all-read": { $post: answer }, ":id": { $delete: answer } },
        agentNotices: { notices: { "mark-read": { $post: answer }, ":id": { $delete: answer } } },
    }),
}));

import { action as staff } from "~/routes/resources/staff-notices";
import { action as agent } from "~/routes/resources/agent-notices";
import { routeArgs } from "../../../tests/helpers/route-args";

const run = (act: typeof staff | typeof agent, intent: string) => {
    const body = new URLSearchParams({ intent, noticeId: "n1" });
    const request = new Request("http://localhost/x", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    return act(routeArgs(request, { params: {}, context: {} as never }) as never) as Promise<{ ok: boolean }>;
};

describe.each([["staff", staff], ["agent", agent]] as const)("%s notices actions", (_n, act) => {
    describe.each(["notice-mark-all-read", "notice-dismiss"])("%s", (intent) => {
        it("is ok when the API accepts it", async () => {
            seam.status = 200;
            expect((await run(act, intent)).ok).toBe(true);
        });
        it("is not ok when the API refuses it", async () => {
            seam.status = 403;
            expect(await run(act, intent)).toMatchObject({ ok: false, intent });
        });
    });
});
