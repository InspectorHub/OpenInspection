// @vitest-environment node
/**
 * The inspection page's three picker lists (inspectors, role profiles,
 * referral sources) are fetched on first use through ONE resource route. Each
 * list reports its own failure as null, never as an empty list: an empty list
 * means "there are none", and a failed read must not read as that.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const seam = vi.hoisted(() => ({
    members: "ok" as "ok" | "fail" | "throw",
    roles: "ok" as "ok" | "fail" | "forbidden" | "throw",
    branding: "ok" as "ok" | "fail" | "throw",
    token: "tok" as string | null,
    calls: [] as string[],
}));

const reply = (mode: "ok" | "fail" | "forbidden" | "throw", data: unknown, name: string) => (..._a: unknown[]) => {
    seam.calls.push(name);
    if (mode === "throw") throw new Error("sync");
    return Promise.resolve({ ok: mode === "ok", status: mode === "forbidden" ? 403 : mode === "ok" ? 200 : 500, json: async () => ({ data }) });
};

vi.mock("~/lib/session.server", () => ({ getToken: async () => { if (seam.token === "boom") throw new Error("session store down"); return seam.token; } }));
vi.mock("~/lib/api-client.server", () => ({
    createApi: () => ({
        inspections: { inspectors: { $get: (...a: unknown[]) => reply(seam.members, [{ id: "u1", name: "Ann", email: "a@x.com" }, { id: "u2", name: null, email: "b@x.com" }], "members")(...a) } },
        roleProfiles: { index: { $get: (...a: unknown[]) => reply(seam.roles, [{ id: "r1", label: "Buyer agent", active: true }], "roles")(...a) } },
        adminBranding: { branding: { $get: (...a: unknown[]) => reply(seam.branding, { branding: { customReferralSources: ["Podcast"] } }, "branding")(...a) } },
    }),
}));

import { loader } from "~/routes/resources/hub-pickers";

const run = async () => {
    const res = (await loader({ request: new Request("http://localhost/resources/hub-pickers"), context: {}, params: {} } as never)) as Response;
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    return (await res.json()) as {
        members: Array<{ id: string; name: string; email: string }> | null;
        roleProfiles: unknown[] | null;
        referralSources: string[] | null;
    };
};

beforeEach(() => {
    seam.members = seam.roles = seam.branding = "ok";
    seam.token = "tok";
    seam.calls = [];
});

describe("hub-pickers loader", () => {
    it("returns all three lists from one request", async () => {
        const out = await run();
        expect(out.members).toEqual([{ id: "u1", name: "Ann", email: "a@x.com" }, { id: "u2", name: "", email: "b@x.com" }]);
        expect(out.roleProfiles).toEqual([{ id: "r1", label: "Buyer agent", active: true }]);
        expect(out.referralSources).toContain("Podcast");
        expect(out.referralSources).toContain("Realtor");
        expect([...seam.calls].sort()).toEqual(["branding", "members", "roles"]);
    });

    it("a failed list is null, not empty, and does not take the others down", async () => {
        seam.members = "fail";
        seam.roles = "throw";
        const out = await run();
        expect(out.members).toBeNull();
        expect(out.roleProfiles).toBeNull();
        expect(out.referralSources).not.toBeNull();
    });

    it("a viewer refused the role list (not an owner or manager) gets an empty list, as before, not an error", async () => {
        seam.roles = "forbidden";
        expect((await run()).roleProfiles).toEqual([]);
        seam.roles = "fail";
        expect((await run()).roleProfiles).toBeNull();
    });

    it("a successful but genuinely empty list stays an empty array", async () => {
        seam.branding = "fail";
        expect((await run()).referralSources).toBeNull();
    });

    it("never throws: a failure outside the three reads answers all-null", async () => {
        seam.token = "boom";
        expect(await run()).toEqual({ members: null, roleProfiles: null, referralSources: null });
    });

    it("without a session it answers all-null and reads nothing", async () => {
        seam.token = null;
        expect(await run()).toEqual({ members: null, roleProfiles: null, referralSources: null });
        expect(seam.calls).toEqual([]);
    });
});
