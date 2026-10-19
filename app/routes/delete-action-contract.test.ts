// @vitest-environment node
/**
 * The page-level contract test (delete-failure-contract.test.tsx) stubs the
 * action, so it cannot notice an action that stops naming its intent. These two
 * actions are what the alert listens for: a refused write answers
 * `{ ok: false, intent }` with the intent the page was told to watch.
 */
import { describe, it, expect, vi } from "vitest";

const seam = vi.hoisted(() => ({ status: 200 }));
vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn().mockResolvedValue("tok") }));
const answer = async () => ({ ok: seam.status < 300, status: seam.status, json: async () => ({}) });
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        contacts: { ":id": { $delete: answer } },
        team: { invites: { ":token": { $delete: answer, resend: { $post: answer } } } },
    }),
}));

import { action as contactsAction } from "~/routes/contacts";
import { action as teamAction } from "~/routes/team";
import { routeArgs } from "../../tests/helpers/route-args";

const run = (act: typeof contactsAction | typeof teamAction, fields: Record<string, string>) => {
    const request = new Request("http://localhost/x", { method: "POST", body: new URLSearchParams(fields), headers: { "content-type": "application/x-www-form-urlencoded" } });
    return act(routeArgs(request, { params: {}, context: {} as never }) as never) as Promise<{ ok: boolean; intent?: string }>;
};

describe.each([
    ["contacts archive", contactsAction, { intent: "delete", id: "c1" }, "delete"],
    ["team cancel invite", teamAction, { intent: "cancel-invite", token: "t1" }, "cancel-invite"],
    ["team resend invite", teamAction, { intent: "resend-invite", token: "t1" }, "resend-invite"],
] as const)("%s action", (_n, act, fields, intent) => {
    it("is ok and names its intent when the API accepts it", async () => {
        seam.status = 200;
        expect(await run(act, { ...fields })).toMatchObject({ ok: true, intent });
    });
    it("is not ok and still names its intent when the API refuses it", async () => {
        seam.status = 403;
        expect(await run(act, { ...fields })).toMatchObject({ ok: false, intent });
    });
});
