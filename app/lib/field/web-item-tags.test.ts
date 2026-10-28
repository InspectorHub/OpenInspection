import { describe, expect, it, vi } from "vitest";
import { ITEM_TAGS_ROUTE, createWebItemTags } from "./web-item-tags";

function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

const asFetch = (fn: unknown) => fn as unknown as typeof fetch;

describe("createWebItemTags.list", () => {
    it("GETs the route with the inspection id and the session cookie, and answers the item -> tags map", async () => {
        const tags = { "item-a": [{ id: "t1", name: "Urgent", color: "#f97316" }] };
        const fetchImpl = vi.fn(async () => json({ tags }));
        await expect(createWebItemTags(asFetch(fetchImpl)).list("insp/1")).resolves.toEqual(tags);
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(`${ITEM_TAGS_ROUTE}?inspectionId=insp%2F1`);
        expect(init.credentials).toBe("include");
    });

    it("answers an empty map as a map (nothing tagged is an answer, not a failure)", async () => {
        await expect(createWebItemTags(asFetch(vi.fn(async () => json({ tags: {} })))).list("i")).resolves.toEqual({});
    });

    it("answers null whenever it could not read: a null body, an error, a redirect, a non-JSON page, a throw", async () => {
        const cases: Array<() => Promise<Response>> = [
            async () => json({ tags: null }),
            async () => json({ tags: [] }),
            async () => json({}, { status: 500 }),
            async () => Object.defineProperty(json({ tags: {} }), "redirected", { value: true }),
            async () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }),
            async () => { throw new Error("offline"); },
        ];
        for (const respond of cases) {
            await expect(createWebItemTags(asFetch(respond)).list("i")).resolves.toBeNull();
        }
    });
});

describe("createWebItemTags.add / remove", () => {
    const post = async (call: "add" | "remove", answer: Response = json({ success: true })) => {
        const fetchImpl = vi.fn(async () => answer);
        const result = await createWebItemTags(asFetch(fetchImpl))[call]("insp-1", "item-a", "tag-1");
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        return { result, url, init, form: init.body as FormData };
    };

    it("POSTs the intent and the three ids to the route", async () => {
        for (const intent of ["add", "remove"] as const) {
            const { result, url, init, form } = await post(intent);
            expect(result).toEqual({ ok: true });
            expect(url).toBe(ITEM_TAGS_ROUTE);
            expect(init.method).toBe("POST");
            expect(init.credentials).toBe("include");
            expect(Object.fromEntries(form.entries())).toEqual({ intent, inspectionId: "insp-1", itemId: "item-a", tagId: "tag-1" });
        }
    });

    it("answers not-ok when the route says it did not store it, on an error status, on a redirect, and on a throw", async () => {
        expect((await post("add", json({ success: false }))).result).toEqual({ ok: false });
        expect((await post("add", json({ success: true }, { status: 500 }))).result).toEqual({ ok: false });
        expect((await post("remove", Object.defineProperty(json({ success: true }), "redirected", { value: true }))).result).toEqual({ ok: false });
        const failing = asFetch(async () => { throw new Error("offline"); });
        await expect(createWebItemTags(failing).add("i", "x", "t")).resolves.toEqual({ ok: false });
        await expect(createWebItemTags(failing).remove("i", "x", "t")).resolves.toEqual({ ok: false });
    });
});
