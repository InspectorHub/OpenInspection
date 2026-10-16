// @vitest-environment happy-dom
/**
 * The hub rendered for an owner, an inspector on the job and office staff, with each role's
 * capabilities taken from the SERVER's table (`getCapabilities`) rather than written by hand.
 * One fixture builder; the verbs that appear are checked against what those capabilities
 * and the server's rules allow.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import InspectionHubPage from "./inspector-portal";
import { getCapabilities, type PermissionOverrides } from "../../server/lib/auth/capabilities";
import { isAdminRole, type Role } from "../../server/lib/auth/roles";

afterEach(cleanup);

/** One loader payload for a role: capabilities from the server table, the job on the role's own terms. */
interface Who { onJob?: boolean; overrides?: PermissionOverrides | null }

function hubFor(role: Role, job: { status: string; reportStatus: string }, who: Who = {}) {
    const caps = getCapabilities(role, who.overrides ?? null);
    return {
        hub: {
            inspection: {
                id: "insp1", status: job.status, reportStatus: job.reportStatus, paymentRequired: false, agreementRequired: false,
                propertyAddress: "1 Main St", clientLocale: null, courtesyTranslationEnabled: false,
                unlockedAt: null, unlockedByName: null, unlockReason: null, date: "2026-06-18T10:00:00Z",
                // Inspectors are on this job; the others reach it through their role or scheduleOthers.
                inspectorId: (who.onJob ?? role === "inspector") ? "me" : "someone-else", templateId: null, price: 0, paymentStatus: "unpaid",
                coverPhoto: null, createdAt: null, closingDate: null, referenceNumber: null, referralSource: null,
            },
            tenantSlug: "acme",
            people: { inspector: null, client: null, buyerAgents: [], listingAgents: [] },
            services: [], agreements: [], agreementRequests: [], invoice: null, reports: [],
            publishReadiness: { ready: true, blockingCount: 0, blockers: [] },
            lifecycle: { moneyCollected: false, statusBeforeCancel: null },
        },
        smsConsent: null, reinspectCandidates: [], canPublishCap: caps.publish, scheduleOthers: caps.scheduleOthers, userId: "me",
        canViewCommunication: false, documents: [], people: [], roleProfiles: [], isAdmin: isAdminRole(role), versions: [],
        members: [], serviceCatalog: [], referralSources: [], visits: [], visitTypes: [], suggestedTypeIds: [],
        role, statutoryForm: { available: false },
    };
}

async function verbsFor(role: Role, job: { status: string; reportStatus: string }, labels: string[], who: Who = {}): Promise<string[]> {
    const Stub = createRoutesStub([{ path: "/inspections/:id", Component: InspectionHubPage, loader: () => hubFor(role, job, who) }]);
    const view = render(<Stub initialEntries={["/inspections/insp1"]} />);
    await waitFor(() => expect(view.container.textContent).toContain("1 Main St"));
    const present = labels.filter((l) => Array.from(view.container.querySelectorAll("button, a")).some((e) => (e.textContent ?? "").includes(l)));
    cleanup();
    return present;
}

describe("hub verbs by role, from the server's capability table", () => {
    const OPEN = { status: "scheduled", reportStatus: "in_progress" };
    const PUBLISHED = { status: "completed", reportStatus: "published" };
    const OPEN_VERBS = ["Mark fieldwork complete", "Cancel inspection", "Edit schedule"];

    it("an open job: owner and inspector have every verb, staff have the booking verbs and not the inspector's", async () => {
        expect(await verbsFor("owner", OPEN, OPEN_VERBS)).toEqual(OPEN_VERBS);
        expect(await verbsFor("inspector", OPEN, OPEN_VERBS)).toEqual(OPEN_VERBS);
        expect(await verbsFor("staff", OPEN, OPEN_VERBS)).toEqual(["Cancel inspection", "Edit schedule"]);
    });

    it("a published report: Unpublish follows the publish capability, which staff never hold", async () => {
        for (const role of ["owner", "inspector", "staff"] as const) {
            const wantsUnpublish = getCapabilities(role, null).publish;
            const present = await verbsFor(role, PUBLISHED, ["Unpublish"]);
            expect(present.includes("Unpublish"), role).toBe(wantsUnpublish);
        }
        expect(getCapabilities("staff", null).publish).toBe(false);
        expect(getCapabilities("owner", null).publish).toBe(true);
    });

    it("a published report: every role that may act on the job can send it; staff do so without the publish capability", async () => {
        for (const role of ["owner", "inspector", "staff"] as const) {
            expect(await verbsFor(role, PUBLISHED, ["Send report"]), role).toEqual(["Send report"]);
        }
    });

    it("an inspector not on the job has none of the acts; with scheduleOthers switched on for them they have all of them, and a manager with it off has none", async () => {
        const away = { onJob: false };
        expect(await verbsFor("inspector", OPEN, OPEN_VERBS, away)).toEqual([]);
        expect(await verbsFor("inspector", OPEN, OPEN_VERBS, { ...away, overrides: { scheduleOthers: true } })).toEqual(OPEN_VERBS);
        expect(await verbsFor("manager", OPEN, OPEN_VERBS, { onJob: false, overrides: { scheduleOthers: false } })).toEqual([]);
        // Control: a manager with the default holds scheduleOthers and has them.
        expect(await verbsFor("manager", OPEN, OPEN_VERBS, away)).toEqual(OPEN_VERBS);
    });

    it("a started job: staff lose Cancel and Edit schedule, and the owner keeps them", async () => {
        const started = { status: "scheduled", reportStatus: "submitted" };
        expect(await verbsFor("staff", started, ["Cancel inspection", "Edit schedule"])).toEqual([]);
        expect(await verbsFor("owner", started, ["Cancel inspection", "Edit schedule"])).toEqual(["Cancel inspection", "Edit schedule"]);
    });
});
