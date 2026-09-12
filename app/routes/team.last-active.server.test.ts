/**
 * F15 / F66 layer 2 — the /team loader must CARRY `lastActiveAt` through.
 *
 * Two layers dropped this column and each was sufficient on its own to make the
 * LAST ACTIVE cell a permanent em dash: `TeamService.getMembers` did not select
 * it (held by `tests/unit/team/members-last-active.spec.ts`), and this loader
 * then mapped every active row with `lastActiveAt: null` hardcoded. Fixing
 * either one alone changes nothing on screen, which is why both have a test.
 *
 * The discriminating assertion is that the loader's row carries the timestamp
 * the API answered with. A test that only checked the key's presence, or that
 * the value was `null` for a row with no timestamp, passed before the fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const membersGet = vi.fn();
const contextGet = vi.fn();
const requireToken = vi.fn();

vi.mock("~/lib/session.server", () => ({
    requireToken: (...args: unknown[]) => requireToken(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        team: { members: { $get: membersGet } },
        sessionContext: { context: { $get: contextGet } },
    })),
}));

import { loader } from "./team";
import { routeArgs } from "../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof loader>[0]["context"];
const ACTIVE_AT = "2026-09-10T06:05:37.000Z";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
    vi.clearAllMocks();
    requireToken.mockResolvedValue("t");
    contextGet.mockResolvedValue(json({ success: true, data: { user: { role: "owner" } } }));
    membersGet.mockResolvedValue(
        json({
            success: true,
            data: {
                members: [
                    { id: "u-owner", email: "owner@a.test", name: "Owner", role: "owner", lastActiveAt: ACTIVE_AT },
                    { id: "u-new", email: "new@a.test", name: "Newcomer", role: "inspector", lastActiveAt: null },
                ],
                invites: [
                    { id: "inv-1", email: "p@a.test", role: "inspector", expiresAt: ACTIVE_AT },
                ],
            },
        }),
    );
});

const load = () =>
    loader(routeArgs(new Request("https://x/team"), { params: {}, context: CONTEXT }));

describe("the /team loader carries last-active through", () => {
    it("CONTROL — the loader really does read the members endpoint", async () => {
        // Without this, every assertion below could be satisfied by a loader
        // that answered from a hardcoded roster.
        await load();
        expect(membersGet).toHaveBeenCalledTimes(1);
    });

    it("an active member's row carries the timestamp the API answered with", async () => {
        const data = await load();
        const owner = data.members.find((m) => m.id === "u-owner");
        expect(owner?.lastActiveAt).toBe(ACTIVE_AT);
    });

    it("a member with nothing recorded carries null, and so does a pending invite", async () => {
        const data = await load();
        // The two rows for which an em dash is the honest answer — kept as the
        // positive control, so "always null" cannot pass as a fix.
        expect(data.members.find((m) => m.id === "u-new")?.lastActiveAt).toBeNull();
        expect(data.members.find((m) => m.id === "inv-1")?.lastActiveAt).toBeNull();
    });
});
