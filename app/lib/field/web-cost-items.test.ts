import { describe, expect, it, vi } from "vitest";
import type { CostItemView } from "@core/field-ui/data-source-types";
import { COST_ITEMS_ROUTE, createWebCostItems } from "./web-cost-items";

function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

const ITEM: CostItemView = {
    id: "c1", system: "Roof", component: "Shingles", location: "", action: "repair", costMethod: "unit",
    quantity: 3, uom: "ea", unitCostCents: 1500, lumpSumCents: null, eul: null, effAge: null, rul: 4,
    suggestedRemedy: "", bucket: "short_term", sectionRef: null, photoRef: null, sortOrder: 2,
};

describe("createWebCostItems.list", () => {
    it("GETs the resource route with the inspection id and the session cookie, and answers the lines and the reserve switch", async () => {
        const items = [{ id: "c1" }, { id: "c2" }];
        const fetchImpl = vi.fn(async () => json({ items, reserveEnabled: true }));
        const listing = await createWebCostItems(fetchImpl as unknown as typeof fetch).list("insp/1");
        expect(listing).toEqual({ items, reserveEnabled: true });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/resources/cost-items?inspectionId=insp%2F1");
        expect(url.startsWith(COST_ITEMS_ROUTE)).toBe(true);
        expect(init.credentials).toBe("include");
        expect(init.method).toBeUndefined();
    });

    it("treats anything but a true reserve switch as off", async () => {
        const fetchImpl = async () => json({ items: [], reserveEnabled: "yes" });
        await expect(createWebCostItems(fetchImpl as unknown as typeof fetch).list("i")).resolves.toEqual({ items: [], reserveEnabled: false });
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
            await expect(createWebCostItems(respond as unknown as typeof fetch).list("i")).resolves.toEqual({ items: [], reserveEnabled: false });
        }
    });
});

describe("createWebCostItems.save", () => {
    const post = async (write: Parameters<ReturnType<typeof createWebCostItems>["save"]>[1], answer: Response = json({ success: true, id: "new-1" })) => {
        const fetchImpl = vi.fn(async () => answer);
        const result = await createWebCostItems(fetchImpl as unknown as typeof fetch).save("insp-1", write);
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        return { result, url, init, form: init.body as FormData };
    };

    it("posts a create as the form the drawer built, and answers the stored id", async () => {
        const { result, url, init, form } = await post({ intent: "create", item: ITEM });
        expect(result).toEqual({ ok: true, data: { id: "new-1" } });
        expect(url).toBe("/resources/cost-items");
        expect(init.method).toBe("POST");
        expect(init.credentials).toBe("include");
        expect(Object.fromEntries(form.entries())).toEqual({
            intent: "create", inspectionId: "insp-1", system: "Roof", component: "Shingles", location: "", action: "repair",
            costMethod: "unit", quantity: "3", uom: "ea", unitCostCents: "1500", lumpSumCents: "", eul: "", effAge: "",
            rul: "4", suggestedRemedy: "", bucket: "short_term", sortOrder: "2",
        });
    });

    it("carries the item id on an update and sends only the id on a delete", async () => {
        const update = await post({ intent: "update", item: ITEM }, json({ success: true }));
        expect(update.form.get("itemId")).toBe("c1");
        expect(update.form.get("intent")).toBe("update");
        expect(update.result).toEqual({ ok: true, data: {} });
        const del = await post({ intent: "delete", itemId: "c9" }, json({ success: true }));
        expect([...del.form.keys()].sort()).toEqual(["inspectionId", "intent", "itemId"]);
        expect(del.form.get("itemId")).toBe("c9");
    });

    it("never throws: a refusal, a bad status and a network error are all { ok: false }", async () => {
        for (const answer of [json({ success: false }), json({}, { status: 500 }), json(null)]) {
            expect((await post({ intent: "delete", itemId: "c1" }, answer)).result.ok).toBe(false);
        }
        const failing = (async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch;
        await expect(createWebCostItems(failing).save("i", { intent: "delete", itemId: "c1" })).resolves.toEqual({ ok: false });
    });
});
