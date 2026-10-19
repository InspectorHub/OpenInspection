// @vitest-environment node
/**
 * The hub page delete intent goes through the shared helper: a delete of an
 * inspection that is already gone is a success, so its row is not brought back.
 */
import { describe, it, expect, vi } from "vitest";

const seam = vi.hoisted(() => ({ status: 200, calls: [] as string[] }));
vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        inspections: {
            ":id": {
                $delete: async ({ param }: { param: { id: string } }) => {
                    seam.calls.push(param.id);
                    return { ok: seam.status < 300, status: seam.status, json: async () => ({ error: { message: "nope" } }) };
                },
            },
        },
    }),
}));

import { action } from "~/routes/inspector-portal";
import { routeArgs } from "../../tests/helpers/route-args";

const run = () => {
    const body = new URLSearchParams({ intent: "delete" });
    const request = new Request("http://localhost/inspections/insp-9", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    return action(routeArgs(request, { params: { id: "insp-9" }, context: {} as never }) as never) as Promise<{ ok: boolean; intent: string }>;
};

describe("hub action intent=delete", () => {
    it("deletes the id it was given", async () => {
        seam.status = 200; seam.calls = [];
        expect(await run()).toMatchObject({ ok: true, intent: "delete" });
        expect(seam.calls).toEqual(["insp-9"]);
    });
    it("treats an inspection that is already gone (404) as deleted", async () => {
        seam.status = 404;
        expect(await run()).toMatchObject({ ok: true, intent: "delete" });
    });
    it("reports a refusal", async () => {
        seam.status = 403;
        expect(await run()).toMatchObject({ ok: false, intent: "delete" });
    });
});
