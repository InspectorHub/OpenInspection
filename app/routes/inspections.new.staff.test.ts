/**
 * The New Inspection page reads its inspector list from the assignee endpoint, which the
 * schedule routes themselves use, not from the owner-only member list. Office staff can
 * reach it, so they can name an inspector when they book.
 */
import { describe, it, expect, vi } from "vitest";

const calls = vi.hoisted(() => ({ names: [] as string[], inspectorsStatus: 200 }));

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn().mockResolvedValue("tok") }));
vi.mock("~/lib/api-client.server", () => {
    const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify({ data }), { status }));
    return {
        createApi: () => ({
            inspections: {
                templates: { $get: () => json([]) },
                inspectors: {
                    $get: () => {
                        calls.names.push("inspectors");
                        return calls.inspectorsStatus === 200
                            ? json([{ id: "u1", email: "ivan@example.com", role: "inspector" }, { id: "u2", email: "olive@example.com", role: "owner", name: "Olive" }])
                            : json(null, calls.inspectorsStatus);
                    },
                },
            },
            services: { index: { $get: () => json([]) } },
            admin: { members: { $get: () => { calls.names.push("admin-members"); return json([]); } } },
            usage: { summary: { $get: () => json({}) } },
        }),
    };
});

import { loader } from "~/routes/inspections.new";
import { routeArgs } from "../../tests/helpers/route-args";

const run = () => loader(routeArgs(new Request("https://x/inspections/new"), { params: {}, context: {} as never }) as never) as Promise<{ teamMembers: Array<{ id: string; name: string }> }>;

describe("/inspections/new loader", () => {
    it("lists the assignable inspectors from the assignee endpoint, naming by name or else email", async () => {
        calls.names = [];
        calls.inspectorsStatus = 200;
        expect((await run()).teamMembers).toEqual([{ id: "u1", name: "ivan@example.com" }, { id: "u2", name: "Olive" }]);
        expect(calls.names).toEqual(["inspectors"]);
    });

    it("CONTROL - someone who may not reassign gets 403 and an empty list, which hides the team step", async () => {
        calls.names = [];
        calls.inspectorsStatus = 403;
        expect((await run()).teamMembers).toEqual([]);
    });
});
