// @vitest-environment node
/**
 * The inspection page's loader reads what the cards show on first paint. The
 * three lists that only feed pickers (inspectors for the Schedule card, role
 * profiles for the add-person dialog, referral sources for Order details) are
 * not read here: they load on first use, through resources/hub-pickers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/lib/load-context";

const seam = vi.hoisted(() => ({ calls: [] as string[], hubMissing: false }));

const okJson = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => ({ data }), text: async () => "" });
const DEFAULTS: Record<string, unknown> = {
    "inspections.:id.hub": { inspection: { id: "i1", status: "draft", propertyAddress: "1 Main", reportStatus: null }, services: [], reports: [] },
    "auth.me": { user: { id: "u1", role: "owner" }, capabilities: {} },
};

function fakeApi(): unknown {
    const make = (path: string[]): unknown => new Proxy(() => undefined, {
        get: (_t, key) => {
            if (typeof key === "symbol" || key === "then") return undefined;
            if (key === "$get" || key === "$post") {
                return (..._a: unknown[]) => {
                    const name = path.join(".");
                    seam.calls.push(name);
                    if (name === "inspections.:id.hub" && seam.hubMissing) return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => "" });
                    return okJson(DEFAULTS[name] ?? []);
                };
            }
            return make([...path, String(key)]);
        },
    });
    return make([]);
}

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("~/lib/api-client.server", () => ({ createApi: () => fakeApi() }));

import { loader } from "~/routes/inspector-portal";
import { routeArgs } from "../../tests/helpers/route-args";

function context() {
    const ctx = new RouterContextProvider();
    ctx.set(cloudflareContext, {
        env: { API_WORKER: { fetch: async () => { seam.calls.push("documents"); return new Response(JSON.stringify({ data: [] }), { status: 200 }); } } } as never,
        ctx: undefined,
    });
    return ctx as unknown as Parameters<typeof loader>[0]["context"];
}
const run = () => loader(routeArgs(new Request("http://localhost/inspections/i1"), { params: { id: "i1" }, context: context() }) as never) as Promise<Record<string, unknown>>;

beforeEach(() => { seam.calls = []; seam.hubMissing = false; });

describe("inspection page loader", () => {
    it("does not read the three picker lists, and no longer returns them", async () => {
        const out = await run();
        for (const picker of ["inspections.inspectors", "roleProfiles.index", "adminBranding.branding"]) expect(seam.calls, picker).not.toContain(picker);
        for (const key of ["members", "roleProfiles", "referralSources"]) expect(out, key).not.toHaveProperty(key);
    });

    it("still reads what the cards show first, and the blocking count is pinned", async () => {
        await run();
        for (const needed of ["inspections.:id.hub", "auth.me", "inspections.:id.people", "documents", "services.index", "inspections.:id.versions", "inspections.:id.statutory-form"]) {
            expect(seam.calls, needed).toContain(needed);
        }
        // Eight first-wave reads plus the two visit reads: ten, from thirteen.
        expect(seam.calls.length).toBeLessThanOrEqual(11);
    });

    it("keeps the data that decides the status code blocking: a missing inspection is still a 404", async () => {
        seam.hubMissing = true;
        await expect(run()).rejects.toMatchObject({ status: 404 });
    });

    it("keeps the catalogue (it also drives the visit suggestions) and the service picker list", async () => {
        const out = await run();
        expect(out).toHaveProperty("serviceCatalog");
        expect(out).toHaveProperty("suggestedTypeIds");
    });
});
