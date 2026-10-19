// @vitest-environment node
/**
 * The list's delete-many intent goes through the shared helper: a delete of an
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

import { action } from "~/routes/inspections";
import { routeArgs } from "../../tests/helpers/route-args";

const run = (ids: string) => {
    const body = new URLSearchParams({ intent: "delete-many", ids });
    const request = new Request("http://localhost/inspections", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    return action(routeArgs(request, { params: {}, context: {} as never }) as never) as Promise<{ ok: boolean; intent: string; deleted: string[]; failed: Array<{ id: string }> }>;
};

describe("/inspections action intent=delete-many", () => {
    it("deletes every id it was given, in one request", async () => {
        seam.status = 200; seam.calls = [];
        expect(await run("insp-9,insp-8")).toMatchObject({ ok: true, intent: "delete-many", deleted: ["insp-9", "insp-8"], failed: [] });
        expect(seam.calls).toEqual(["insp-9", "insp-8"]);
    });
    it("treats an inspection that is already gone (404) as deleted", async () => {
        seam.status = 404;
        expect(await run("insp-9")).toMatchObject({ ok: true, deleted: ["insp-9"] });
    });
    it("reports a refusal per id", async () => {
        seam.status = 403;
        const out = await run("insp-9");
        expect(out).toMatchObject({ ok: false, deleted: [] });
        expect(out.failed.map((f) => f.id)).toEqual(["insp-9"]);
    });
});
