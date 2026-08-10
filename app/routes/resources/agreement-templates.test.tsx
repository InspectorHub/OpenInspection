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
const brandingGet = vi.fn();
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
        adminBranding: { branding: { $get: brandingGet } },
    })),
}));

import { loader, action } from "./agreement-templates";
import { routeArgs } from "../../../tests/helpers/route-args";
/** Minimal AppLoadContext stub — the route only forwards it to createApi. */
const CONTEXT = {} as Parameters<typeof loader>[0]["context"];

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const TEMPLATES = [
    { id: "a1", tenantId: "t1", name: "Residential", content: "<p>Terms A</p>", version: 3 },
    { id: "a2", tenantId: "t1", name: "Commercial", content: "<p>Terms B</p>", version: 1 },
];

/** A branding payload whose cancellation clause is in the named state. */
const branding = (clause: { current: boolean; everAttested: boolean; agreementId: string | null }) =>
    json({ success: true, data: { branding: { cancellationClause: clause } } });

/** Nobody has ever confirmed a clause — the state every workspace starts in. */
const NO_CLAUSE = { current: false, everAttested: false, agreementId: null };

function get(query: Record<string, string>) {
    const url = `https://x/resources/agreement-templates?${new URLSearchParams(query)}`;
    return loader(routeArgs(new Request(url), { params: {}, context: CONTEXT }));
}

function post(fields: Record<string, string>) {
    const request = new Request("https://x/resources/agreement-templates", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
    });
    return action(routeArgs(request, { params: {}, context: CONTEXT }));
}

beforeEach(() => {
    listGet.mockReset();
    createPost.mockReset();
    updatePut.mockReset();
    removeDelete.mockReset();
    brandingGet.mockReset().mockResolvedValue(branding(NO_CLAUSE));
    getToken.mockReset().mockResolvedValue("tok");
});

describe("agreement-template loader", () => {
    it("returns the one template asked for, body included", async () => {
        // There is no GET-one endpoint on the server — only the list — so the
        // route selects from the list rather than pretending an endpoint exists.
        listGet.mockResolvedValue(json({ success: true, data: TEMPLATES }));
        const res = await get({ id: "a2" });
        expect(res).toEqual({
            ok: true,
            template: { id: "a2", name: "Commercial", content: "<p>Terms B</p>" },
            clauseAttested: false,
        });
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

/**
 * #83 — the editor must be able to say that saving costs something.
 *
 * `PUT /agreements/{id}` increments `agreements.version` on EVERY save, and
 * `BrandingService.getCancellationAttestation()` returns null the moment the
 * attested version stops matching the current one. So editing the template the
 * cancellation fees rest on revokes the attestation, and the next attempt to
 * save a fee-charging policy is refused. Until the editor shipped nothing could
 * bump that version, so the path had never fired.
 *
 * ⚠️ THE ANSWER COMES FROM THE BRANDING ENDPOINT, NOT FROM A RULE RESTATED HERE.
 * `cancellationClause.current` is computed server-side by the same function the
 * fee gate reads. Deriving "is this attested" in the loader from the raw columns
 * plus a version comparison would be a second copy of the invalidation rule, and
 * the copy the warning is based on would eventually disagree with the gate.
 *
 * The attestation NAMES ONE TEMPLATE (`cancellation_clause_agreement_id`), so
 * the warning is scoped to that one — the pairs below are the positive control.
 */
describe("agreement-template loader — cancellation-clause warning", () => {
    beforeEach(() => {
        listGet.mockResolvedValue(json({ success: true, data: TEMPLATES }));
    });

    it("flags the template the live attestation names", async () => {
        brandingGet.mockResolvedValue(branding({ current: true, everAttested: true, agreementId: "a1" }));
        const res = await get({ id: "a1" });
        expect(res).toMatchObject({ ok: true, clauseAttested: true });
    });

    it("does NOT flag a different template in the same workspace", async () => {
        // The positive control for the assertion above. A bare "this workspace
        // has an attestation" boolean would warn on every agreement edit and
        // teach an author to ignore the banner.
        brandingGet.mockResolvedValue(branding({ current: true, everAttested: true, agreementId: "a1" }));
        const res = await get({ id: "a2" });
        expect(res).toMatchObject({ ok: true, clauseAttested: false });
    });

    it("does NOT flag a template whose attestation has already drifted", async () => {
        // Nothing is left to revoke: a previous edit already cleared it, and
        // the settings panel is already showing the "confirm again" state.
        brandingGet.mockResolvedValue(branding({ current: false, everAttested: true, agreementId: "a1" }));
        const res = await get({ id: "a1" });
        expect(res).toMatchObject({ ok: true, clauseAttested: false });
    });

    it("refuses to open rather than open with the warning unanswered", async () => {
        // Fail-closed, the same way an unreadable template list is. Opening the
        // editor with `clauseAttested: false` because a read failed would be the
        // silent revocation this whole change exists to remove.
        brandingGet.mockResolvedValue(json({ success: false }, 500));
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
        expect(res).toEqual({ ok: true, intent: "create", id: "new-1", clauseRevoked: false });
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
        expect(res).toEqual({ ok: true, intent: "update", id: "a1", clauseRevoked: false });
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
        expect(res).toEqual({ ok: true, intent: "delete", id: "a1", clauseRevoked: false });
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

/**
 * #84 — the server says what a write revoked; this route must hand that on.
 *
 * `PUT` and `DELETE /agreements/{id}` return
 * `effects.cancellationFeeAttestationRevoked`, computed by reading
 * `getCancellationAttestation()` on both sides of the write. The page turns it
 * into a notice. What must NOT happen here is this route re-deriving the answer
 * from the id it just posted: that would be a second copy of the invalidation
 * rule, and the copy behind the notice would eventually disagree with the copy
 * behind the refusal. It relays, and nothing else.
 */
describe("agreement-template action — relaying the revocation signal", () => {
    const withEffects = (revoked: boolean, data?: unknown) =>
        json({ success: true, effects: { cancellationFeeAttestationRevoked: revoked }, ...(data ? { data } : {}) });

    it("relays a save that revoked the cancellation-fee confirmation", async () => {
        updatePut.mockResolvedValue(withEffects(true, { agreement: { id: "a1" } }));
        expect(await post({ intent: "update", id: "a1", name: "N", content: "<p>c</p>" }))
            .toEqual({ ok: true, intent: "update", id: "a1", clauseRevoked: true });
    });

    it("relays a save that revoked nothing", async () => {
        // The positive control. A route that reported `true` whenever an
        // attestation exists anywhere would warn on every template.
        updatePut.mockResolvedValue(withEffects(false, { agreement: { id: "a2" } }));
        expect(await post({ intent: "update", id: "a2", name: "N", content: "<p>c</p>" }))
            .toEqual({ ok: true, intent: "update", id: "a2", clauseRevoked: false });
    });

    it("relays a delete that revoked the cancellation-fee confirmation", async () => {
        removeDelete.mockResolvedValue(withEffects(true));
        expect(await post({ intent: "delete", id: "a1" }))
            .toEqual({ ok: true, intent: "delete", id: "a1", clauseRevoked: true });
    });

    it("relays a delete that revoked nothing", async () => {
        removeDelete.mockResolvedValue(withEffects(false));
        expect(await post({ intent: "delete", id: "a2" }))
            .toEqual({ ok: true, intent: "delete", id: "a2", clauseRevoked: false });
    });

    it("claims no revocation when the response carries no signal at all", async () => {
        // Creating a template cannot revoke anything, so `POST /agreements`
        // declares no `effects`. Absence must read as "nothing was revoked" and
        // never as "unknown, so warn" — an unconditional warning on every
        // create is how a notice stops being read.
        createPost.mockResolvedValue(json({ success: true, data: { agreement: { id: "new-1" } } }, 201));
        expect(await post({ intent: "create", name: "X", content: "<p>y</p>" }))
            .toEqual({ ok: true, intent: "create", id: "new-1", clauseRevoked: false });
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
