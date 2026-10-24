import { describe, expect, it, vi } from "vitest";
import { COMMENTS_LIBRARY_ROUTE, createWebCommentsLibrary } from "./web-comments-library";

function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

const ROW = { id: "c1", text: "T", category: null, severity: "good", section: "Roof" };
const ENTRY = { text: "Body", severity: "significant", section: "Roof", category: "Cat", itemLabel: "Shingles" };

function fields(init: RequestInit): Array<[string, string]> {
    return [...(init.body as FormData).entries()].map(([k, v]) => [k, String(v)]);
}

describe("createWebCommentsLibrary.list", () => {
    it("GETs the route with the session cookie and returns the loader's comments", async () => {
        const fetchImpl = vi.fn(async () => json({ comments: [ROW] }));
        const rows = await createWebCommentsLibrary(fetchImpl as unknown as typeof fetch).list();
        expect(rows).toEqual([ROW]);
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/resources/comments-library");
        expect(url).toBe(COMMENTS_LIBRARY_ROUTE);
        expect(init).toEqual({ credentials: "include" });
    });

    it("serialises the query names as the route reads them, in the order given, skipping empty members", async () => {
        const fetchImpl = vi.fn(async () => json({ comments: [] }));
        await createWebCommentsLibrary(fetchImpl as unknown as typeof fetch).list({
            sort: "relevance", filterMode: "auto", search: "roof leak", severity: "significant", itemLabel: "Shingles & flashing", section: "", pageSize: undefined,
        });
        const [url] = fetchImpl.mock.calls[0] as unknown as [string];
        // Identical to what `new URLSearchParams(...)` produced in the hook: `+` for spaces, %26 for an ampersand.
        expect(url).toBe("/resources/comments-library?sort=relevance&filterMode=auto&search=roof+leak&severity=significant&itemLabel=Shingles+%26+flashing");
    });

    it("sends no query string for an empty query", async () => {
        const fetchImpl = vi.fn(async () => json({ comments: [] }));
        await createWebCommentsLibrary(fetchImpl as unknown as typeof fetch).list({});
        expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("/resources/comments-library");
    });

    it("answers [] when the route fails, answers no comments, answers non-JSON or the request throws", async () => {
        const cases: Array<() => Promise<Response>> = [
            async () => json({}, { status: 500 }),
            async () => json({}),
            async () => new Response("<html></html>", { status: 200 }),
            async () => {
                throw new Error("offline");
            },
        ];
        for (const respond of cases) {
            await expect(createWebCommentsLibrary(respond as unknown as typeof fetch).list({ search: "x" })).resolves.toEqual([]);
        }
    });
});

describe("createWebCommentsLibrary writes", () => {
    it("touch POSTs intent=touch and the id as multipart form fields", async () => {
        const fetchImpl = vi.fn(async () => json({ ok: true }));
        const res = await createWebCommentsLibrary(fetchImpl as unknown as typeof fetch).touch("c1");
        expect(res).toEqual({ ok: true });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/resources/comments-library");
        expect(init.method).toBe("POST");
        expect(init.credentials).toBe("include");
        expect(init.body).toBeInstanceOf(FormData);
        expect(fields(init)).toEqual([["intent", "touch"], ["id", "c1"]]);
    });

    it("save POSTs the same fields the hook form carried, in the same order", async () => {
        const fetchImpl = vi.fn(async () => json({ ok: true }));
        expect(await createWebCommentsLibrary(fetchImpl as unknown as typeof fetch).save(ENTRY)).toEqual({ ok: true });
        const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(fields(init)).toEqual([
            ["intent", "save"], ["text", "Body"], ["severity", "significant"], ["section", "Roof"], ["category", "Cat"], ["itemLabel", "Shingles"],
        ]);
    });

    it("edit adds the id, and the optional repair fields only when given", async () => {
        const fetchImpl = vi.fn(async () => json({ ok: true }));
        const lib = createWebCommentsLibrary(fetchImpl as unknown as typeof fetch);
        await lib.edit("c1", ENTRY);
        await lib.edit("c1", { ...ENTRY, repairSummary: "Re-seal", recommendedContractorTypeId: "roofer" });
        const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
        expect(fields(calls[0]![1]).map(([k]) => k)).toEqual(["intent", "id", "text", "severity", "section", "category", "itemLabel"]);
        expect(fields(calls[0]![1])[0]).toEqual(["intent", "edit"]);
        expect(fields(calls[1]![1]).slice(-2)).toEqual([["repairSummary", "Re-seal"], ["recommendedContractorTypeId", "roofer"]]);
    });

    it("a write is ok only when the route answers { ok: true }; anything else is a not-ok answer, never a throw", async () => {
        const cases: Array<[() => Promise<Response>, RegExp]> = [
            [async () => json({ ok: false }), /^The comment was not saved\.$/],
            [async () => json({}), /^The comment was not saved\.$/],
            [async () => new Response("nope", { status: 200 }), /^The comment was not saved\.$/],
            [async () => json({ ok: true }, { status: 500 }), /500/],
            [
                async () => {
                    throw new Error("offline");
                },
                /^offline$/,
            ],
        ];
        for (const [respond, error] of cases) {
            const lib = createWebCommentsLibrary(respond as unknown as typeof fetch);
            for (const res of [await lib.touch("c1"), await lib.save(ENTRY), await lib.edit("c1", ENTRY)]) {
                expect(res.ok).toBe(false);
                expect(res.error).toMatch(error);
            }
        }
    });
});
