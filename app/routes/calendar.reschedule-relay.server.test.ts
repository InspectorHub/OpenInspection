/**
 * What a calendar reschedule brings BACK from the API.
 *
 * `PATCH /api/inspections/:id` already decides whether moving the date changed
 * which statutory revision governs the inspection, and returns it as
 * `revisionStatus`. `patch-revision-report.ts` says why in its own words: a
 * reschedule is a daily operation, and a daily operation with a hidden
 * consequence is a trap.
 *
 * This action answered `{ ok: res.ok }`. The verdict was computed on every
 * reschedule and discarded before anything could render it — a fact about the
 * RESPONSE, which no rendering test could see and no server test could fail.
 * That is what this file reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const inspectionPatch = vi.fn();
const requireToken = vi.fn();

vi.mock("~/lib/session.server", () => ({
    getToken: vi.fn(),
    requireToken: (...args: unknown[]) => requireToken(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({ inspections: { ":id": { $patch: inspectionPatch } } })),
}));

import { action } from "./calendar";
import { routeArgs } from "../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof action>[0]["context"];

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CANNOT_PRODUCE = {
    kind: "cannot_produce",
    applicableVersion: "Rev. 04/26",
    templateVersion: "Rev. 03/25",
};

beforeEach(() => {
    vi.clearAllMocks();
    requireToken.mockResolvedValue("t");
});

function reschedule(date = "2026-06-01") {
    const form = new FormData();
    form.append("intent", "reschedule");
    form.append("id", "insp-1");
    form.append("date", date);
    return action(routeArgs(
        new Request("https://x/calendar", { method: "POST", body: form }),
        { params: {}, context: CONTEXT },
    ));
}

describe("rescheduling from the calendar", () => {
    it("CONTROL — the action really patches the inspection", async () => {
        // Without this, every assertion below is satisfied by an action that
        // calls nothing and returns a hard-coded object.
        inspectionPatch.mockResolvedValue(json({ success: true }));
        await reschedule();
        expect(inspectionPatch).toHaveBeenCalledTimes(1);
        expect((inspectionPatch.mock.calls[0]![0] as { json: { date: string } }).json.date)
            .toBe("2026-06-01");
    });

    it("carries the revision verdict back to the page", async () => {
        inspectionPatch.mockResolvedValue(json({ success: true, data: { revisionStatus: CANNOT_PRODUCE } }));
        const result = await reschedule();
        expect(result).toMatchObject({ ok: true, revisionStatus: CANNOT_PRODUCE });
    });

    it("carries the new date back too, because every sentence interpolates it", async () => {
        inspectionPatch.mockResolvedValue(json({ success: true, data: { revisionStatus: CANNOT_PRODUCE } }));
        expect(await reschedule("2026-07-14")).toMatchObject({ date: "2026-07-14" });
    });

    it("reports null — not undefined — when the API said nothing", async () => {
        // The overwhelmingly common case: the inspection produces no statutory
        // form, so the API omits the key. The page must be able to tell that
        // apart from a body it failed to read.
        inspectionPatch.mockResolvedValue(json({ success: true }));
        expect(await reschedule()).toMatchObject({ ok: true, revisionStatus: null });
    });

    it("does not invent a verdict from a failed patch", async () => {
        // A refused reschedule changed no date, so there is no new revision to
        // report. Reading the body here would at best relay an error envelope
        // into a banner about statutory revisions.
        inspectionPatch.mockResolvedValue(json({ success: false, error: "nope" }, 400));
        expect(await reschedule()).toMatchObject({ ok: false, revisionStatus: null });
    });

    it("survives a body that is not JSON, rather than failing the reschedule", async () => {
        // The date HAS been written by this point. Throwing here would report a
        // failed reschedule for a reschedule that succeeded.
        inspectionPatch.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
        expect(await reschedule()).toMatchObject({ ok: true, revisionStatus: null });
    });
});
