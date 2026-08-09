// @vitest-environment happy-dom
/**
 * #67 — the agreement-template BFF route.
 *
 * `POST /agreements`, `PUT /agreements/{id}` and `DELETE /agreements/{id}` all
 * shipped complete on the server and a grep of `app/` for any of the three came
 * back empty: the Library page listed templates and offered a "+ New agreement"
 * button with no handler on it. This route is the seam that reaches them, so
 * what it must be pinned on is what it does with the answers.
 *
 * The load-bearing properties:
 *   - EVERY path is fail-closed on the session. A client `fetch('/api/...')`
 *     arrives with no JWT in this repository, which is exactly why this route
 *     exists; it must refuse rather than call the API unauthenticated.
 *   - The editor's HTML is forwarded VERBATIM. The server sanitizer is the
 *     write-time boundary, and a route that pre-trimmed or re-escaped would
 *     store something other than what the boundary was shown.
 *   - Empty content is refused HERE. `content` is `min(1)` in the API's Zod
 *     schema, so an empty save is a 400 the UI would render as a generic
 *     failure — the route answers the question instead of relaying a rejection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const listGet = vi.fn();
const createPost = vi.fn();
const updatePut = vi.fn();
const removeDelete = vi.fn();
const getToken = vi.fn();

vi.mock("~/lib/session.server", () => ({
    getToken: (...args: unknown[]) => getToken(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({
        admin: {
            agreements: Object.assign(
                { $get: listGet, $post: createPost },
                { ":id": { $put: updatePut, $delete: removeDelete } },
            ),
        },
    })),
}));

import { loader, action } from "./agreement-templates";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const TEMPLATES = [
    { id: "a1", tenantId: "t1", name: "Residential", content: "<p>Terms A</p>", version: 3 },
    { id: "a2", tenantId: "t1", name: "Commercial", content: "<p>Terms B</p>", version: 1 },
];

function get(query: Record<string, string>) {
    const url = `https://x/resources/agreement-templates?${new URLSearchParams(query)}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return loader({ request: new Request(url), params: {}, context: {} as any });
}

function post(fields: Record<string, string>) {
    const request = new Request("https://x/resources/agreement-templates", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return action({ request, params: {}, context: {} as any });
}

beforeEach(() => {
    listGet.mockReset();
    createPost.mockReset();
    updatePut.mockReset();
    removeDelete.mockReset();
    getToken.mockReset().mockResolvedValue("tok");
});

describe("agreement-template loader", () => {
    it("returns the one template asked for, body included", async () => {
        // There is no GET-one endpoint on the server — only the list — so the
        // route selects from the list rather than pretending an endpoint exists.
        listGet.mockResolvedValue(json({ success: true, data: TEMPLATES }));
        const res = await get({ id: "a2" });
        expect(res).toEqual({ ok: true, template: { id: "a2", name: "Commercial", content: "<p>Terms B</p>" } });
    });

    it("loads nothing when there is no session", async () => {
        getToken.mockResolvedValue(null);
        const res = await get({ id: "a2" });
        expect(listGet).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });

    it("refuses a missing id instead of guessing a template", async () => {
        const res = await get({});
        expect(listGet).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });

    it("does not invent an empty template when the id is not in the tenant's list", async () => {
        // Returning `{ content: "" }` here would open the editor on a blank
        // document and a save would overwrite a real agreement with nothing.
        listGet.mockResolvedValue(json({ success: true, data: TEMPLATES }));
        const res = await get({ id: "someone-elses" });
        expect(res.ok).toBe(false);
        expect(res).not.toHaveProperty("template");
    });

    it("reports a failed list rather than an empty one", async () => {
        listGet.mockResolvedValue(json({ success: false }, 403));
        const res = await get({ id: "a1" });
        expect(res.ok).toBe(false);
    });
});

describe("agreement-template action — create", () => {
    it("forwards the name and the editor's HTML verbatim", async () => {
        createPost.mockResolvedValue(json({ success: true, data: { agreement: { id: "new-1" } } }, 201));
        const res = await post({ intent: "create", name: " Residential ", content: "<p>A <strong>term</strong></p>" });

        expect(createPost).toHaveBeenCalledWith({
            json: { name: "Residential", content: "<p>A <strong>term</strong></p>" },
        });
        expect(res).toEqual({ ok: true, intent: "create", id: "new-1" });
    });

    it("creates nothing when there is no session", async () => {
        getToken.mockResolvedValue(null);
        const res = await post({ intent: "create", name: "X", content: "<p>y</p>" });
        expect(createPost).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });

    it("refuses an empty name or an empty body without calling the API", async () => {
        expect((await post({ intent: "create", name: "  ", content: "<p>y</p>" })).ok).toBe(false);
        expect((await post({ intent: "create", name: "X", content: "" })).ok).toBe(false);
        // Markup with no words in it is an empty body, not a body.
        expect((await post({ intent: "create", name: "X", content: "<p><br></p>" })).ok).toBe(false);
        expect(createPost).not.toHaveBeenCalled();
    });

    it("reports a rejection instead of claiming the template was created", async () => {
        createPost.mockResolvedValue(json({ success: false, error: { message: "Name too long" } }, 400));
        const res = await post({ intent: "create", name: "X", content: "<p>y</p>" });
        expect(res).toEqual({ ok: false, intent: "create", error: "Name too long" });
    });
});

describe("agreement-template action — update", () => {
    it("addresses the template by id and sends both fields", async () => {
        updatePut.mockResolvedValue(json({ success: true, data: { agreement: { id: "a1" } } }));
        const res = await post({ intent: "update", id: "a1", name: "Residential v2", content: "<p>New</p>" });

        expect(updatePut).toHaveBeenCalledWith({
            param: { id: "a1" },
            json: { name: "Residential v2", content: "<p>New</p>" },
        });
        expect(res).toEqual({ ok: true, intent: "update", id: "a1" });
    });

    it("updates nothing without a session or without an id", async () => {
        getToken.mockResolvedValue(null);
        expect((await post({ intent: "update", id: "a1", name: "N", content: "<p>c</p>" })).ok).toBe(false);
        getToken.mockResolvedValue("tok");
        expect((await post({ intent: "update", name: "N", content: "<p>c</p>" })).ok).toBe(false);
        expect(updatePut).not.toHaveBeenCalled();
    });

    it("refuses to blank out an existing agreement", async () => {
        // `AgreementSchema.partial()` on the PUT means an omitted `content`
        // keeps the stored one — but an empty STRING is still a value, and the
        // service would sanitize "" to "" and store it. A template whose body
        // silently became empty is the worst failure this surface has.
        expect((await post({ intent: "update", id: "a1", name: "N", content: "" })).ok).toBe(false);
        expect((await post({ intent: "update", id: "a1", name: "N", content: "<p>   </p>" })).ok).toBe(false);
        expect(updatePut).not.toHaveBeenCalled();
    });
});

describe("agreement-template action — delete", () => {
    it("deletes by id", async () => {
        removeDelete.mockResolvedValue(json({ success: true }));
        const res = await post({ intent: "delete", id: "a1" });
        expect(removeDelete).toHaveBeenCalledWith({ param: { id: "a1" } });
        expect(res).toEqual({ ok: true, intent: "delete", id: "a1" });
    });

    it("deletes nothing when there is no session", async () => {
        getToken.mockResolvedValue(null);
        const res = await post({ intent: "delete", id: "a1" });
        expect(removeDelete).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });

    it("deletes nothing when no id was supplied", async () => {
        const res = await post({ intent: "delete" });
        expect(removeDelete).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });

    it("reports a refusal rather than reporting a deletion", async () => {
        removeDelete.mockResolvedValue(json({ success: false, error: { message: "Agreement template not found" } }, 404));
        const res = await post({ intent: "delete", id: "gone" });
        expect(res.ok).toBe(false);
    });
});

describe("agreement-template action — unknown intent", () => {
    it("does nothing at all", async () => {
        const res = await post({ intent: "exfiltrate", id: "a1" });
        expect(createPost).not.toHaveBeenCalled();
        expect(updatePut).not.toHaveBeenCalled();
        expect(removeDelete).not.toHaveBeenCalled();
        expect(res.ok).toBe(false);
    });
});
