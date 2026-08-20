/**
 * The server half of `/settings/imports/:batchId`: what it ASKS the API for, and
 * what it does with each control's press.
 *
 * Separate from the render spec next door because it mocks the API client, and a
 * file that both mocks it and renders through it would be asserting on a client
 * the page never uses.
 *
 * Two things live here and nowhere else:
 *
 *  1. THE PAGE PARAMETER. The entries needing a person are paged by the SERVER —
 *     the report carries one page of them plus the count behind it. The page
 *     control writes `?page=` into the address, and if the loader does not pass
 *     it on, every page renders the first one. That failure is invisible to a
 *     rendering test whose loader is stubbed, and invisible on screen: the page
 *     control highlights the page that was clicked either way.
 *  2. THE FOUR WRITES. `op` decides which endpoint a press reaches, and a
 *     mis-wired arm posts a well-formed request to the wrong route — the shape
 *     of which is not visible anywhere in the DOM.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const reportGet = vi.fn();
const mappingPatch = vi.fn();
const rowPatch = vi.fn();
const applyPost = vi.fn();
const revertPost = vi.fn();
const requireAdminLoader = vi.fn();

vi.mock("~/lib/access.server", () => ({
    requireAdminLoader: (...args: unknown[]) => requireAdminLoader(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        imports: {
            ":batchId": Object.assign(
                { $get: reportGet },
                {
                    mapping: { $patch: mappingPatch },
                    rows: { ":rowId": { $patch: rowPatch } },
                    apply: { $post: applyPost },
                    revert: { $post: revertPost },
                },
            ),
        },
    })),
}));

import { loader, action } from "./settings-imports-batch";
import { routeArgs } from "../../tests/helpers/route-args";

/** Minimal AppLoadContext stub — the route only forwards it to `createApi`. */
const CONTEXT = {} as Parameters<typeof loader>[0]["context"];

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
    vi.clearAllMocks();
    requireAdminLoader.mockResolvedValue({ forbidden: false, token: "t" });
    reportGet.mockResolvedValue(json({ success: true, data: { counts: { total: 0 } } }));
    for (const write of [mappingPatch, rowPatch, applyPost, revertPost]) {
        write.mockResolvedValue(json({ success: true, data: {} }));
    }
});

function load(search = "") {
    return loader(routeArgs(
        new Request(`https://x/settings/imports/b1${search}`),
        { params: { batchId: "b1" }, context: CONTEXT },
    ));
}

function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return action(routeArgs(
        new Request("https://x/settings/imports/b1", { method: "POST", body: form }),
        { params: { batchId: "b1" }, context: CONTEXT },
    ));
}

describe("reading a run", () => {
    it("asks for the page the address names", async () => {
        await load("?page=3");
        expect(reportGet).toHaveBeenCalledWith({
            param: { batchId: "b1" },
            query: { page: "3" },
        });
    });

    it("asks for no page at all when the address names none", async () => {
        // The control for the case above: a loader that always sent `page=1`
        // would satisfy it and would also override the server's own default the
        // day that default changes.
        await load();
        expect(reportGet).toHaveBeenCalledWith({ param: { batchId: "b1" }, query: {} });
    });

    it("passes the page size on too, so the size control is not a decoration", async () => {
        await load("?page=2&pageSize=50");
        expect(reportGet).toHaveBeenCalledWith({
            param: { batchId: "b1" },
            query: { page: "2", pageSize: "50" },
        });
    });

    it("reads nothing at all for a role that may not import", async () => {
        requireAdminLoader.mockResolvedValue({ forbidden: true, token: "" });
        expect(await load()).toEqual({ forbidden: true, report: null });
        expect(reportGet).not.toHaveBeenCalled();
    });

    it("answers with no run rather than a partial one when the API refuses", async () => {
        reportGet.mockResolvedValue(json({ error: { message: "gone" } }, 404));
        expect(await load()).toEqual({ forbidden: false, report: null });
    });
});

describe("changing a run", () => {
    it("sends a new mapping to the mapping endpoint, parsed rather than as a string", async () => {
        const mapping = { kind: "contacts", mapping: { name: "Full Name", type: { fixed: "client" } } };
        await post({ op: "mapping", mapping: JSON.stringify(mapping) });
        expect(mappingPatch).toHaveBeenCalledWith({ param: { batchId: "b1" }, json: { mapping } });
        expect(rowPatch).not.toHaveBeenCalled();
    });

    it("sends one corrected entry to that entry's own address", async () => {
        const payload = { name: "Alice Ng", email: "a@example.test", type: "client" };
        await post({ op: "repair", rowId: "row-7", payload: JSON.stringify(payload) });
        expect(rowPatch).toHaveBeenCalledWith({
            param: { batchId: "b1", rowId: "row-7" },
            json: { payload },
        });
    });

    it("sends the clash policy with the apply, because apply has no default for it", async () => {
        await post({ op: "apply", conflictPolicy: "overwrite" });
        expect(applyPost).toHaveBeenCalledWith({
            param: { batchId: "b1" },
            json: { conflictPolicy: "overwrite" },
        });
    });

    it("sends the undo with nothing but the run it undoes", async () => {
        await post({ op: "revert" });
        expect(revertPost).toHaveBeenCalledWith({ param: { batchId: "b1" } });
    });

    it("writes nothing for an op it does not recognise", async () => {
        // Fail closed. An unknown op reaching a default arm that guessed would
        // be a form field deciding which endpoint a press lands on.
        const result = await post({ op: "delete-everything" });
        for (const write of [mappingPatch, rowPatch, applyPost, revertPost]) {
            expect(write).not.toHaveBeenCalled();
        }
        expect(result).toEqual({ error: expect.any(String) });
    });

    it("writes nothing for a role that may not import", async () => {
        requireAdminLoader.mockResolvedValue({ forbidden: true, token: "" });
        await post({ op: "revert" });
        expect(revertPost).not.toHaveBeenCalled();
    });

    it("hands back the server's own sentence when a write is refused", async () => {
        // Not one of ours: the server is the only party that knows the run has
        // moved on, that its file is gone, or how many seats are left.
        applyPost.mockResolvedValue(json(
            { error: { message: "This import needs 3 seats and 1 are available." } },
            402,
        ));
        expect(await post({ op: "apply", conflictPolicy: "skip" }))
            .toEqual({ error: "This import needs 3 seats and 1 are available." });
    });

    it("reports success as no error at all, so the banner is not printed", async () => {
        expect(await post({ op: "revert" })).toEqual({ error: null });
    });
});
