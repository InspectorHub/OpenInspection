// @vitest-environment happy-dom
/**
 * `/calendar` — what a drag-and-drop reschedule says about the statutory form.
 *
 * `PATCH /api/inspections/:id` already decides this. `patch-revision-report.ts`
 * runs `revisionStatusForInspection` on every date patch and returns the
 * verdict as `revisionStatus`, with a comment stating the reason plainly:
 * moving a date can carry an inspection across a mandatory cutover, and "a
 * daily operation with a hidden consequence is a trap rather than a feature".
 *
 * The calendar's action answered `{ ok: res.ok }` and threw the body away. So
 * the judgement was computed on every reschedule and shown to nobody — the
 * editor's banner was the only surface that ever rendered one, and it is not
 * where rescheduling happens. These tests pin the wire, not the judgement.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { RevisionBanner } from "~/components/statutory/RevisionBanner";
import type { RevisionStatus } from "../../server/lib/statutory/revision-status";

const CANNOT_PRODUCE: RevisionStatus = {
    kind: "cannot_produce",
    applicableVersion: "Rev. 04/26",
    templateVersion: "Rev. 03/25",
};

/**
 * The page's own render of the advisory, extracted so the assertion is about
 * what a rescheduler sees rather than about the calendar's whole DOM.
 */
function Advisory({ data }: { data: { revisionStatus?: RevisionStatus | null; date?: string } }) {
    return data.revisionStatus ? (
        <RevisionBanner status={data.revisionStatus} inspectionDate={data.date} />
    ) : null;
}

function renderAdvisory(data: { revisionStatus?: RevisionStatus | null; date?: string }) {
    const Stub = createRoutesStub([
        { path: "/calendar", Component: () => <Advisory data={data} /> },
    ]);
    return render(<Stub initialEntries={["/calendar"]} />);
}

describe("a reschedule that changes which revision governs the inspection", () => {
    it("says the form can no longer be produced, and names both revisions", () => {
        renderAdvisory({ revisionStatus: CANNOT_PRODUCE, date: "2026-06-01" });

        const text = document.body.textContent ?? "";
        expect(text).toContain("Rev. 04/26");
        expect(text).toContain("Rev. 03/25");
    });

    it("carries the new date into the sentence", () => {
        // Every one of these sentences interpolates the inspection's date. The
        // first version of this wire relayed only the status, which rendered
        // "This inspection is dated , which falls under revision …" — a blank
        // where the whole point of the message was.
        renderAdvisory({ revisionStatus: CANNOT_PRODUCE, date: "2026-06-01" });
        expect(document.body.textContent ?? "").toContain("2026-06-01");
    });

    it("renders nothing for an inspection with no statutory form", () => {
        // Which is nearly all of them. The API omits the key rather than
        // sending null, so silence here is the correct and common case — and a
        // banner that appeared on every reschedule would be trained away
        // within a week.
        renderAdvisory({ revisionStatus: null, date: "2026-06-01" });
        expect(screen.queryByRole("status")).toBeNull();
        expect((document.body.textContent ?? "").trim()).toBe("");
    });
});
