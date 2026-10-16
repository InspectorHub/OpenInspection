// @vitest-environment happy-dom
/**
 * The inspection hub for office staff: the booking controls stay, the inspector's own
 * ones go, and each rests on what the server allows (staff cancel only an unpaid job
 * that has not started; who, where and when freeze at the start; a requirement can be
 * switched on and not off). "Send report" no longer depends on the publish capability.
 *
 * Every withheld control is paired with the owner, who has it.
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
    canSendReport?: boolean;
}

function loaderData(o: Opts) {
    return {
        hub: {
            inspection: {
                id: "insp1", status: o.status ?? "scheduled", reportStatus: o.reportStatus ?? "in_progress",
                paymentRequired: false, agreementRequired: o.agreementRequired ?? false,
                propertyAddress: "1 Main St", clientLocale: null, courtesyTranslationEnabled: false,
                unlockedAt: null, unlockedByName: null, unlockReason: null, date: "2026-06-18T10:00:00Z",
                inspectorId: null, templateId: null, price: 0, paymentStatus: o.paymentStatus ?? "unpaid", coverPhoto: null,
                createdAt: null, closingDate: null, referenceNumber: null, referralSource: null,
            },
            tenantSlug: "acme",
            people: { inspector: null, client: null, buyerAgents: [], listingAgents: [] },
            services: [], agreements: [], agreementRequests: [], invoice: null, reports: [],
            publishReadiness: { ready: true, blockingCount: 0, blockers: [] },
        },
        smsConsent: null, reinspectCandidates: [], canPublishCap: o.canPublishCap ?? false, canSendReport: o.canSendReport ?? false,
        canViewCommunication: false, documents: [], people: [], roleProfiles: [], isAdmin: o.role === "owner", versions: [],
        members: [], serviceCatalog: [], referralSources: [], visits: [], visitTypes: [], suggestedTypeIds: [],
        role: o.role, statutoryForm: { available: false },
    };
}

async function renderHub(o: Opts) {
    const Stub = createRoutesStub([{ path: "/inspections/:id", Component: InspectionHubPage, loader: () => loaderData(o) }]);
    const view = render(<Stub initialEntries={["/inspections/insp1"]} />);
    await waitFor(() => expect(view.container.textContent).toContain("1 Main St"));
    const text = () => view.container.textContent ?? "";
    const has = (label: string) => Array.from(view.container.querySelectorAll("button, a")).some((e) => (e.textContent ?? "").includes(label));
    return { ...view, text, has };
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

    it("cannot cancel once money is collected, and the owner still can", async () => {
        expect((await renderHub({ role: "staff", paymentStatus: "paid" })).has("Cancel inspection")).toBe(false);
        cleanup();
        expect((await renderHub({ role: "owner", paymentStatus: "paid" })).has("Cancel inspection")).toBe(true);
    });

    it("cannot cancel or reschedule once the inspection has started, and the owner still can", async () => {
        const staff = await renderHub({ role: "staff", status: "completed", reportStatus: "submitted" });
        expect(staff.has("Cancel inspection")).toBe(false);
        expect(staff.has("Edit schedule")).toBe(false);
        cleanup();
        const owner = await renderHub({ role: "owner", status: "scheduled", reportStatus: "submitted" });
        expect(owner.has("Edit schedule")).toBe(true);
    });

    it("sends a published report without the publish capability, and cannot publish or unpublish it", async () => {
        const hub = await renderHub({ role: "staff", reportStatus: "published", canPublishCap: false, canSendReport: true });
        expect(hub.has("Send report")).toBe(true);
        expect(hub.has("Create re-inspection")).toBe(true);
        expect(hub.has("Unpublish")).toBe(false);
    });

    it("CONTROL - without the send flag the button is gone, so the flag is what shows it", async () => {
        const hub = await renderHub({ role: "staff", reportStatus: "published", canPublishCap: true, canSendReport: false });
        expect(hub.has("Send report")).toBe(false);
    });

    it("can switch the agreement requirement on but not off", async () => {
        const off = await renderHub({ role: "staff", agreementRequired: false });
        expect(off.container.querySelector('[data-testid="hub-gate-agreement"]')).not.toBeNull();
        cleanup();
        const on = await renderHub({ role: "staff", agreementRequired: true });
        expect(on.container.querySelector('[data-testid="hub-gate-agreement"]')).toBeNull();
        cleanup();
        const owner = await renderHub({ role: "owner", agreementRequired: true });
        expect(owner.container.querySelector('[data-testid="hub-gate-agreement"]')).not.toBeNull();
    });
});
