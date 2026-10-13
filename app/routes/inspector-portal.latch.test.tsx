// @vitest-environment happy-dom
/**
 * The Report card's submit, return and unpublish forms post through fetchers whose
 * state flips only after a render. Two submits dispatched in one frame must reach
 * the route action once, and a later submit after the action settles must go through.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import InspectionHubPage from "./inspector-portal";

afterEach(cleanup);

let intents: string[] = [];
let release: () => void = () => {};
beforeEach(() => {
    intents = [];
    release = () => {};
});

function loaderData(reportStatus: string, canPublishCap: boolean) {
    return {
        hub: {
            inspection: {
                id: "insp1", status: "completed", reportStatus, paymentRequired: false, agreementRequired: false,
                propertyAddress: "1 Main St", clientLocale: null, courtesyTranslationEnabled: false,
                unlockedAt: null, unlockedByName: null, unlockReason: null, date: "2026-06-18T10:00:00Z",
                inspectorId: null, templateId: null, price: 0, paymentStatus: "unpaid", coverPhoto: null,
                createdAt: null, closingDate: null, referenceNumber: null, referralSource: null,
            },
            tenantSlug: "acme",
            people: { inspector: null, client: null, buyerAgents: [], listingAgents: [] },
            services: [],
            agreements: [],
            agreementRequests: [],
            invoice: null,
            reports: [],
            publishReadiness: { ready: true, blockingCount: 0, blockers: [] },
        },
        smsConsent: null, reinspectCandidates: [], canPublishCap, canViewCommunication: false, documents: [],
        people: [], roleProfiles: [], isAdmin: false, versions: [], members: [], serviceCatalog: [],
        referralSources: [], visits: [], visitTypes: [], suggestedTypeIds: [], role: "owner", statutoryForm: { available: false },
    };
}

async function check(reportStatus: string, canPublishCap: boolean, intent: string) {
    const Stub = createRoutesStub([
        {
            path: "/inspections/:id",
            Component: InspectionHubPage,
            loader: () => loaderData(reportStatus, canPublishCap),
            action: async ({ request }) => {
                intents.push(String((await request.formData()).get("intent")));
                await new Promise<void>((resolve) => { release = resolve; });
                return { ok: false, intent };
            },
        },
    ]);
    const { container } = render(<Stub initialEntries={["/inspections/insp1"]} />);
    const button = await waitFor(() => {
        const found = container.querySelector<HTMLButtonElement>(`form:has(input[name="intent"][value="${intent}"]) button[type="submit"]`);
        expect(found).not.toBeNull();
        return found!;
    });
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(intents).toHaveLength(1));
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    expect(intents).toEqual([intent]);
    await act(async () => { release(); });
    await waitFor(() => expect(button.getAttribute("aria-disabled")).not.toBe("true"));
    act(() => { button.click(); });
    await waitFor(() => expect(intents).toEqual([intent, intent]));
    await act(async () => { release(); });
    expect(screen).toBeDefined();
}

describe("inspector-portal report actions", () => {
    it("submits the report once for a double click", async () => {
        await check("in_progress", false, "submit");
    });

    it("returns the report once for a double click", async () => {
        await check("submitted", true, "return");
    });

    it("unpublishes the report once for a double click", async () => {
        await check("published", true, "unpublish");
    });
});
