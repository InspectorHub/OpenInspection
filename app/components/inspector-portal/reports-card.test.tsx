// @vitest-environment happy-dom
/**
 * The order's report list, and the one irreversible control on it.
 *
 * Two things are pinned. First, the delete confirmation NAMES what is lost:
 * the report by title, and that the content already filled into it is
 * destroyed. A generic "are you sure?" is the same dialog whether it is about
 * to discard an empty draft or a day of somebody's fieldwork.
 *
 * Second, the card never re-derives who may delete what. `canDelete` and
 * `deleteBlockedReason` come from the same server function the DELETE endpoint
 * enforces, so a blocked row is disabled AND says why — the failure mode being
 * guarded against is a button that looks live, does nothing, and explains
 * nothing.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { ReportsCard, type ReportRow } from "~/components/inspector-portal/ReportsCard";

const PRIMARY: ReportRow = {
    id: "rep-primary", kind: "primary", title: "Inspection Report", status: "in_progress",
    publishedAt: null, versionCount: 0, hasContent: false,
    canDelete: false, deleteBlockedReason: "primary",
};
const SEWER: ReportRow = {
    id: "rep-sewer", kind: "ancillary", title: "Sewer Scope", status: "in_progress",
    publishedAt: null, versionCount: 0, hasContent: true,
    canDelete: true, deleteBlockedReason: null,
};
const RADON: ReportRow = {
    id: "rep-radon", kind: "ancillary", title: "Radon Testing", status: "published",
    publishedAt: "2026-08-03T12:00:00.000Z", versionCount: 1, hasContent: false,
    canDelete: false, deleteBlockedReason: "published",
};

function renderCard(reports: ReportRow[], canManage = true, repairLogHref: string | null = null) {
    const calls: Record<string, string>[] = [];
    const Stub = createRoutesStub([
        {
            path: "/hub",
            Component: () => (
                <ReportsCard
                    reports={reports}
                    canManage={canManage}
                    formatDate={(iso) => `on ${iso.slice(0, 10)}`}
                    repairLogHref={repairLogHref}
                />
            ),
            action: async ({ request }) => {
                const form = await request.formData();
                calls.push(Object.fromEntries(form) as Record<string, string>);
                return { ok: true, intent: "report-delete", error: undefined };
            },
        },
    ]);
    render(<Stub initialEntries={["/hub"]} />);
    return { calls };
}

const deleteButtonFor = (title: string) =>
    screen.getAllByTestId("hub-report-row")
        .find((row) => row.textContent?.includes(title))!
        .querySelector("button")!;

describe("ReportsCard", () => {
    it("lists every deliverable on the order", () => {
        renderCard([PRIMARY, SEWER, RADON]);
        expect(screen.getAllByTestId("hub-report-row")).toHaveLength(3);
        expect(screen.getByText("Sewer Scope")).toBeTruthy();
        expect(screen.getByText("Radon Testing")).toBeTruthy();
    });

    it("names the report and what is destroyed with it", async () => {
        renderCard([PRIMARY, SEWER]);
        fireEvent.click(deleteButtonFor("Sewer Scope"));

        const body = await screen.findByText(/Sewer Scope has information filled out in it/);
        // The title alone is not "naming what is lost" — the sentence has to say
        // the entered content goes, or the dialog is decoration.
        expect(body.textContent).toMatch(/destroys that content/i);
        expect(body.textContent).toMatch(/cannot be undone/i);
    });

    it("is honest when there is nothing filled in yet", async () => {
        renderCard([PRIMARY, { ...SEWER, hasContent: false }]);
        fireEvent.click(deleteButtonFor("Sewer Scope"));
        expect(await screen.findByText(/has nothing filled out in it yet/)).toBeTruthy();
    });

    it("submits the delete only after the confirmation is accepted", async () => {
        const { calls } = renderCard([PRIMARY, SEWER]);
        fireEvent.click(deleteButtonFor("Sewer Scope"));
        expect(calls, "opening the dialog already deleted the report").toHaveLength(0);

        // Scoped to the dialog: the rows carry "Delete" buttons too, and a
        // bare query that happened to grab a row button would pass while
        // testing nothing about the confirmation.
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]).toMatchObject({ intent: "report-delete", reportId: "rep-sewer" });
    });

    it("deletes nothing when the confirmation is cancelled", async () => {
        const { calls } = renderCard([PRIMARY, SEWER]);
        fireEvent.click(deleteButtonFor("Sewer Scope"));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByText(/cannot be undone/i)).toBeNull());
        expect(calls).toHaveLength(0);
    });

    it("disables a blocked row AND says why", () => {
        renderCard([PRIMARY, RADON]);

        const primaryBtn = deleteButtonFor("Inspection Report");
        expect(primaryBtn.hasAttribute("disabled")).toBe(true);
        expect(primaryBtn.getAttribute("aria-label")).toMatch(/primary report cannot be deleted/i);

        const radonBtn = deleteButtonFor("Radon Testing");
        expect(radonBtn.hasAttribute("disabled")).toBe(true);
        expect(radonBtn.getAttribute("aria-label")).toMatch(/published report cannot be deleted/i);
    });

    it("offers no delete control at all without the manage capability", () => {
        renderCard([PRIMARY, SEWER], false);
        expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    });

    it("shows the empty state rather than an empty list", () => {
        renderCard([]);
        expect(screen.queryByTestId("hub-reports-list")).toBeNull();
        expect(screen.getByText(/No reports on this order yet/)).toBeTruthy();
    });
});

/**
 * #69 — the card is the inspection record's entry point to the Repair Request
 * Log, and the ONLY place a staff user can reach it.
 *
 * `repairLogHref` is null until the ORDER's report is published, decided by the
 * route (this card knows only each deliverable's own `publishedAt`, which is a
 * different question). These two cases pin the halves of that contract from the
 * card's side: given a href it offers the link, given null it offers nothing —
 * not a disabled control, which would invite a click that cannot work.
 */
describe("ReportsCard — Repair Request Log entry point (#69)", () => {
    it("offers the log once the route says the order is published", () => {
        renderCard([RADON], true, "/inspections/insp1/repair-requests");
        const link = screen.getByTestId("hub-repair-log-link");
        expect(link.getAttribute("href")).toBe("/inspections/insp1/repair-requests");
    });

    it("offers nothing at all while the order is unpublished", () => {
        // Not a disabled button: before publication no repair list can exist,
        // so the page behind it could only explain why it is empty.
        renderCard([PRIMARY], true, null);
        expect(screen.queryByTestId("hub-repair-log-link")).toBeNull();
    });
});
