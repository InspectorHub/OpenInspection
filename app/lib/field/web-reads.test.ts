/**
 * The web host's four read-mostly resources (template search, repair items, media pool, settings sheet) and the
 * version history: the requests they send, and that none of them throws.
 */
import { describe, expect, it, vi } from "vitest";
import { createWebMediaPool } from "./web-media-pool";
import { createWebRepairItems } from "./web-repair-items";
import { createWebSettingsSheet } from "./web-settings-sheet";
import { createWebTemplateSearch } from "./web-template-search";
import { collabBase, createWebVersionHistory } from "./web-version-history";

const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const asFetch = (fn: unknown) => fn as typeof fetch;
const offline = asFetch(async () => {
    throw new Error("offline");
});
const html = asFetch(async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }));

describe("createWebTemplateSearch", () => {
    it("GETs the resource route with the page and, only when set, the query", async () => {
        const fetchImpl = vi.fn(async () => json({ templates: [{ id: "t1", name: "Full" }], hasMore: true, page: 2, totalPages: 3 }));
        const search = createWebTemplateSearch(asFetch(fetchImpl)).search;
        expect(await search({ q: "ful l", page: 2 })).toEqual({ templates: [{ id: "t1", name: "Full" }], hasMore: true, page: 2, totalPages: 3 });
        await search({ q: "", page: 1 });
        expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("/resources/template-search?page=2&q=ful+l");
        expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe("/resources/template-search?page=1");
    });

    it("answers an empty single page when the read fails, answers a page, or throws", async () => {
        const empty = { templates: [], hasMore: false, page: 1, totalPages: 1 };
        for (const f of [offline, html, asFetch(async () => json({}, { status: 500 })), asFetch(async () => json({ templates: "x" }))]) {
            await expect(createWebTemplateSearch(f).search({ q: "", page: 1 })).resolves.toEqual(empty);
        }
    });
});

describe("createWebRepairItems", () => {
    it("GETs the catalogue and answers its items; any failure answers none", async () => {
        const items = [{ id: "r1", name: "Roof", category: null, defaultRepairSummary: "s", contractorTypeName: null }];
        const fetchImpl = vi.fn(async () => json({ items }));
        expect(await createWebRepairItems(asFetch(fetchImpl)).list()).toEqual(items);
        expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("/resources/repair-items");
        for (const f of [offline, asFetch(async () => json({}, { status: 500 })), asFetch(async () => json({ items: 3 }))]) {
            await expect(createWebRepairItems(f).list()).resolves.toEqual([]);
        }
    });
});

describe("createWebMediaPool", () => {
    it("answers the photos and whether the route really answered", async () => {
        const photos = [{ key: "k", url: "/u", label: "L" }];
        const fetchImpl = vi.fn(async () => json({ photos, answered: true }));
        expect(await createWebMediaPool(asFetch(fetchImpl)).list("i 1")).toEqual({ photos, answered: true });
        expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("/resources/inspection-media?inspectionId=i%201");
        await expect(createWebMediaPool(asFetch(async () => json({ photos: [], answered: false }))).list("i")).resolves.toEqual({ photos: [], answered: false });
    });

    it("answers unanswered (not an empty inspection) when the read fails, redirects, answers a page or throws", async () => {
        for (const f of [offline, html, asFetch(async () => json({}, { status: 500 })), asFetch(async () => json({ photos: "x" }))]) {
            await expect(createWebMediaPool(f).list("i")).resolves.toEqual({ photos: [], answered: false });
        }
    });
});

describe("createWebSettingsSheet", () => {
    it("answers the bundle plus the host's appearance profiles", async () => {
        const body = { inspection: { templateId: "t1" }, templates: [{ id: "t1", name: "Full" }], photos: [{ key: "k", url: "/u", label: "L" }], members: [] };
        const fetchImpl = vi.fn(async () => json(body));
        const data = await createWebSettingsSheet(asFetch(fetchImpl)).load("i1");
        expect(data?.inspection).toEqual({ templateId: "t1" });
        expect(data?.templates).toEqual(body.templates);
        expect(data?.photos).toEqual(body.photos);
        expect(data?.profiles.map((p) => p.id)).toEqual(["signature", "meridian", "terra"]);
        expect(data?.profiles.every((p) => Object.keys(p).sort().join() === "id,name")).toBe(true);
        expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("/resources/inspection-settings-sheet?inspectionId=i1");
    });

    it("passes the route's own empty answer on, and answers null when no answer could be read", async () => {
        const empty = await createWebSettingsSheet(asFetch(async () => json({ inspection: null, templates: [], members: [], photos: [] }))).load("i");
        expect(empty?.inspection).toBeNull();
        for (const f of [offline, html, asFetch(async () => json({}, { status: 500 })), asFetch(async () => json(null))]) {
            await expect(createWebSettingsSheet(f).load("i")).resolves.toBeNull();
        }
    });
});

describe("createWebVersionHistory", () => {
    it("lists the snapshots, dropping rows that are not snapshots, and reads one's projection", async () => {
        const rows = [{ seq: 2, atMs: 5, byUserId: "u", reason: "manual" }, { seq: "x" }, { seq: 1, atMs: 4, byUserId: null, reason: "bogus" }];
        const fetchImpl = vi.fn(async (url: string) => (url.endsWith("/snapshots/2") ? json({ projection: { a: 1 } }) : json(rows)));
        const vh = createWebVersionHistory(asFetch(fetchImpl));
        expect(await vh.list("i1")).toEqual({ ok: true, data: [{ seq: 2, atMs: 5, byUserId: "u", reason: "manual" }, { seq: 1, atMs: 4, byUserId: null }] });
        expect(await vh.get("i1", 2)).toEqual({ ok: true, data: { projection: { a: 1 } } });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(`${collabBase("i1")}/snapshots`);
        expect(init.credentials).toBe("same-origin");
    });

    it("a read that fails, or a projection-less answer, is { ok: false }", async () => {
        for (const f of [offline, asFetch(async () => json({}, { status: 500 }))]) {
            expect((await createWebVersionHistory(f).list("i")).ok).toBe(false);
            expect((await createWebVersionHistory(f).get("i", 1)).ok).toBe(false);
        }
        expect((await createWebVersionHistory(asFetch(async () => json({ nope: 1 }))).get("i", 1)).ok).toBe(false);
    });

    it("capture POSTs the snapshots route; restore POSTs the seq and carries the API's sentence on a refusal", async () => {
        const fetchImpl = vi.fn(async () => json({}));
        const vh = createWebVersionHistory(asFetch(fetchImpl));
        expect(await vh.capture("i1")).toEqual({ ok: true });
        expect(await vh.restore("i1", 7)).toEqual({ ok: true });
        const [cUrl, cInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect([cUrl, cInit.method]).toEqual(["/api/inspections/i1/collab/snapshots", "POST"]);
        const [rUrl, rInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
        expect([rUrl, rInit.method, JSON.parse(rInit.body as string)]).toEqual(["/api/inspections/i1/collab/restore", "POST", { seq: 7 }]);
        const refused = createWebVersionHistory(asFetch(async () => json({ error: "Too old" }, { status: 409 })));
        expect(await refused.restore("i", 1)).toEqual({ ok: false, error: "Too old" });
        expect(await createWebVersionHistory(asFetch(async () => json({}, { status: 500 }))).restore("i", 1)).toEqual({ ok: false, error: "Restore failed" });
        expect((await createWebVersionHistory(offline).capture("i")).ok).toBe(false);
    });
});
