// @vitest-environment happy-dom
/**
 * The inspection hub for office staff: the booking controls stay, the inspector's own
 * ones go, and each rests on what the server allows (staff act only on a job they work or
 * with scheduleOthers; cancel only an unpaid job that has not started; who, where and when
 * freeze at the start; a requirement can be switched on and not off; restore only a
 * cancellation that recorded a status that was not completed). "Send report" follows the
 * server's own rule instead of the publish capability.
 *
 * Every withheld control is paired with one who has it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import InspectionHubPage from "./inspector-portal";

afterEach(cleanup);

interface Opts {
    role: string;
    status?: string;
    reportStatus?: string;
    paymentStatus?: string;
    agreementRequired?: boolean;
    canPublishCap?: boolean;
    scheduleOthers?: boolean;
    userId?: string;
    inspectorId?: string | null;
    moneyCollected?: boolean;
    statusBeforeCancel?: string | null;
}

function loaderData(o: Opts) {
    return {
        hub: {
            inspection: {
                id: "insp1", status: o.status ?? "scheduled", reportStatus: o.reportStatus ?? "in_progress",
                paymentRequired: false, agreementRequired: o.agreementRequired ?? false,
                propertyAddress: "1 Main St", clientLocale: null, courtesyTranslationEnabled: false,
                unlockedAt: null, unlockedByName: null, unlockReason: null, date: "2026-06-18T10:00:00Z",
                inspectorId: o.inspectorId ?? null, templateId: null, price: 0, paymentStatus: o.paymentStatus ?? "unpaid", coverPhoto: null,
                createdAt: null, closingDate: null, referenceNumber: null, referralSource: null,
            },
            tenantSlug: "acme",
            people: { inspector: null, client: null, buyerAgents: [], listingAgents: [] },
            services: [], agreements: [], agreementRequests: [], invoice: null, reports: [],
            publishReadiness: { ready: true, blockingCount: 0, blockers: [] },
            lifecycle: { moneyCollected: o.moneyCollected ?? false, statusBeforeCancel: o.statusBeforeCancel ?? null },
        },
        smsConsent: null, reinspectCandidates: [], canPublishCap: o.canPublishCap ?? false,
        scheduleOthers: o.scheduleOthers ?? o.role === "staff", userId: o.userId ?? "me",
        canViewCommunication: false, documents: [], people: [], roleProfiles: [], isAdmin: o.role === "owner", versions: [],
        members: [], serviceCatalog: [], referralSources: [], visits: [], visitTypes: [], suggestedTypeIds: [],
        role: o.role, statutoryForm: { available: false },
    };
}

async function renderHub(o: Opts) {
    const Stub = createRoutesStub([{ path: "/inspections/:id", Component: InspectionHubPage, loader: () => loaderData(o) }]);
    const view = render(<Stub initialEntries={["/inspections/insp1"]} />);
    await waitFor(() => expect(view.container.textContent).toContain("1 Main St"));
    const has = (label: string) => Array.from(view.container.querySelectorAll("button, a")).some((e) => (e.textContent ?? "").includes(label));
    return { ...view, has };
}

/** Render, read whether a control is there, and clean up, so several can be compared in one test. */
async function offers(o: Opts, label: string): Promise<boolean> {
    const hub = await renderHub(o);
    const found = hub.has(label);
    cleanup();
    return found;
}

describe("hub as office staff", () => {
    it("on an unpaid, unstarted job: can cancel and edit the schedule, cannot mark the visit complete", async () => {
        const hub = await renderHub({ role: "staff" });
        expect(hub.has("Cancel inspection")).toBe(true);
        expect(hub.has("Edit schedule")).toBe(true);
        expect(hub.has("Mark fieldwork complete")).toBe(false);
    });

    it("POSITIVE CONTROL - an owner has all three", async () => {
        const hub = await renderHub({ role: "owner" });
        expect(hub.has("Cancel inspection")).toBe(true);
        expect(hub.has("Edit schedule")).toBe(true);
        expect(hub.has("Mark fieldwork complete")).toBe(true);
    });

    it("cannot cancel once money is collected, however it is recorded, and the owner still can", async () => {
        expect(await offers({ role: "staff", paymentStatus: "paid", moneyCollected: true }, "Cancel inspection")).toBe(false);
        // The order flag says unpaid, but the server reports a held deposit or a ledger payment.
        expect(await offers({ role: "staff", moneyCollected: true }, "Cancel inspection")).toBe(false);
        expect(await offers({ role: "owner", moneyCollected: true }, "Cancel inspection")).toBe(true);
    });

    it("cannot cancel or reschedule once the inspection has started, and the owner still can", async () => {
        const started = { status: "completed", reportStatus: "submitted" };
        expect(await offers({ role: "staff", ...started }, "Cancel inspection")).toBe(false);
        expect(await offers({ role: "staff", ...started }, "Edit schedule")).toBe(false);
        expect(await offers({ role: "owner", status: "scheduled", reportStatus: "submitted" }, "Edit schedule")).toBe(true);
    });

    it("gets none of the order controls on a job they may not act on, and gets them on the one assigned to them", async () => {
        const blocked = { role: "staff", scheduleOthers: false };
        for (const label of ["Cancel inspection", "Edit schedule"]) expect(await offers(blocked, label), label).toBe(false);
        const named = { ...blocked, userId: "me", inspectorId: "me" };
        for (const label of ["Cancel inspection", "Edit schedule"]) expect(await offers(named, label), label).toBe(true);
    });

    it("is offered Restore on a cancelled job only when the cancellation recorded a status that was not completed", async () => {
        const cancelled = (statusBeforeCancel: string | null, role = "staff") => offers({ role, status: "cancelled", statusBeforeCancel }, "Restore");
        expect(await cancelled("scheduled")).toBe(true);
        expect(await cancelled("completed")).toBe(false);
        expect(await cancelled(null)).toBe(false);
        // Control: an owner restores one with no record (the server restores from the row).
        expect(await cancelled(null, "owner")).toBe(true);
    });

    it("sends a published report without the publish capability, and cannot publish or unpublish it", async () => {
        const hub = await renderHub({ role: "staff", reportStatus: "published", canPublishCap: false });
        expect(hub.has("Send report")).toBe(true);
        expect(hub.has("Create re-inspection")).toBe(true);
        expect(hub.has("Unpublish")).toBe(false);
    });

    it("sending follows the server rule: a place on the job or scheduleOthers", async () => {
        const published = { role: "staff", reportStatus: "published", scheduleOthers: false };
        expect(await offers(published, "Send report")).toBe(false);
        expect(await offers({ ...published, inspectorId: "me" }, "Send report")).toBe(true);
    });

    it("non-staff keep the earlier condition: an inspector whose publish was withdrawn is not offered a send", async () => {
        const inspector = { role: "inspector", reportStatus: "published", inspectorId: "me", scheduleOthers: false };
        expect(await offers({ ...inspector, canPublishCap: false }, "Send report")).toBe(false);
        expect(await offers({ ...inspector, canPublishCap: true }, "Send report")).toBe(true);
    });

    it("can switch the agreement requirement on but not off", async () => {
        const toggle = async (o: Opts) => (await renderHub(o)).container.querySelector('[data-testid="hub-gate-agreement"]') !== null;
        expect(await toggle({ role: "staff", agreementRequired: false })).toBe(true);
        cleanup();
        expect(await toggle({ role: "staff", agreementRequired: true })).toBe(false);
        cleanup();
        expect(await toggle({ role: "owner", agreementRequired: true })).toBe(true);
    });
});
