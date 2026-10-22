import { describe, expect, it, vi } from "vitest";
import { COST_ITEMS_ROUTE, createWebCostItems } from "./web-cost-items";

function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("createWebCostItems.list", () => {
    it("GETs the resource route with the inspection id and the session cookie, and answers the lines", async () => {
        const items = [{ id: "c1" }, { id: "c2" }];
        const fetchImpl = vi.fn(async () => json({ items, reserveEnabled: true }));
        const listing = await createWebCostItems(fetchImpl as unknown as typeof fetch).list("insp/1");
        expect(listing).toEqual({ items });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/resources/cost-items?inspectionId=insp%2F1");
        expect(url.startsWith(COST_ITEMS_ROUTE)).toBe(true);
        expect(init.credentials).toBe("include");
        expect(init.method).toBeUndefined();
    });

    it("answers no lines when the route fails, redirects, answers a page or something else, or throws", async () => {
        const cases: Array<() => Promise<Response>> = [
            async () => json({ items: [{ id: "c1" }] }, { status: 500 }),
            async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
            async () => json({ items: "nope" }),
            async () => json(null),
            async () => {
                throw new Error("offline");
            },
        ];
        for (const respond of cases) {
            await expect(createWebCostItems(respond as unknown as typeof fetch).list("i")).resolves.toEqual({ items: [] });
        }
    });
});

describe("createWebCostItems.save", () => {
    it("is not wired yet and says so instead of doing nothing", async () => {
        const result = await createWebCostItems().save({});
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not wired/);
    });
});
