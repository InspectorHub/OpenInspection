/**
 * What the marketplace page ASKS the API for — specifically, the kind filter.
 *
 * The tab strip is the whole reason this file exists. It used to set component
 * state that nothing read: the loader forwarded only `page` and `pageSize`, so
 * every tab produced the identical list. Measured in production on 2026-09-02,
 * pressing "Templates" left two comment packs and three statutory forms on
 * screen and the count at 17.
 *
 * ⚠️ Nothing could see it. The API accepted a `kind` the whole time and the
 * service layer filtered on it correctly, so every server-side test passed. A
 * rendering test would have passed too — the strip highlights whichever tab was
 * pressed either way, which is exactly the failure the spec for
 * `/settings/imports/:batchId` describes for its page control. The filtering is
 * a fact about the REQUEST, and only a test that reads the request can hold it.
 *
 * (The strip also offered "Agreements", a kind that has never existed in this
 * repository, and had no tab for `statutory`, which three shipped rows carry.
 * That half is held by `tests/unit/marketplace/browse-kind-coverage.spec.ts`,
 * which asserts against the column's own enum.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const indexGet = vi.fn();
const requireToken = vi.fn();

vi.mock("~/lib/session.server", () => ({
    requireToken: (...args: unknown[]) => requireToken(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({ marketplace: { index: { $get: indexGet } } })),
}));

import { loader } from "./marketplace";
import { routeArgs } from "../../tests/helpers/route-args";
import { MARKETPLACE_KINDS } from "../../server/lib/marketplace-kinds";

const CONTEXT = {} as Parameters<typeof loader>[0]["context"];

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
    vi.clearAllMocks();
    requireToken.mockResolvedValue("t");
    indexGet.mockResolvedValue(json({ success: true, data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } }));
});

const load = (search = "") =>
    loader(routeArgs(new Request(`https://x/library/marketplace${search}`), { params: {}, context: CONTEXT }));

const askedFor = () => (indexGet.mock.calls[0]?.[0] as { query: Record<string, string> }).query;

describe("the kind filter reaches the API", () => {
    it("CONTROL — the loader really does call the catalogue endpoint", async () => {
        // Without this, every "was it asked for" assertion below could be
        // satisfied by a loader that never calls the API at all.
        await load();
        expect(indexGet).toHaveBeenCalledTimes(1);
    });

    it("asks for every kind the catalogue can hold", async () => {
        for (const kind of MARKETPLACE_KINDS) {
            vi.clearAllMocks();
            indexGet.mockResolvedValue(json({ success: true, data: [] }));
            await load(`?kind=${kind}`);
            expect(askedFor().kind, `kind=${kind} was not forwarded`).toBe(kind);
        }
    });

    it("omits the filter entirely when the address names no kind", async () => {
        // "All" is a real answer and must not be sent as a value: `kind=all`
        // would be refused by the query schema, turning the default tab into an
        // error.
        await load();
        expect(askedFor()).not.toHaveProperty("kind");
    });

    it("omits a kind the catalogue cannot hold rather than passing it on", async () => {
        // A hand-edited address should render the unfiltered catalogue, not a
        // 400 from the API. The loader narrows to the known list first.
        await load("?kind=agreements");
        expect(askedFor()).not.toHaveProperty("kind");
    });

    it("still forwards paging alongside the filter", async () => {
        await load("?kind=statutory&page=2&pageSize=25");
        expect(askedFor()).toEqual({ page: "2", pageSize: "25", kind: "statutory" });
    });
});
