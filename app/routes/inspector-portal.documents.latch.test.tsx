// @vitest-environment happy-dom
/**
 * Inspector document upload / delete same-frame guards: the busy flag only lands after a render, so two
 * drops in ONE frame must store the file once, and two deletes of the same document must reach the API once
 * (the second would answer 404 and show a false "delete failed").
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";

type DocsProps = {
    onUpload: (f: File, o: { category: string; visibility: string }) => void;
    onDelete: (id: string) => void;
};
const docs = vi.hoisted(() => ({ props: null as null | DocsProps }));
vi.mock("~/components/DocumentsSection", () => ({
    default: (p: DocsProps) => { docs.props = p; return null; },
}));

import InspectionHubPage from "./inspector-portal";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const res = () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response;

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

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    fetchMock = vi.fn(async () => res());
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

async function mount() {
    const Stub = createRoutesStub([
        { path: "/inspections/:id", Component: InspectionHubPage, loader: () => loaderData("in_progress", false) },
    ]);
    render(<Stub initialEntries={["/inspections/insp1"]} />);
    await settle();
}
const file = new File(["x"], "a.pdf", { type: "application/pdf" });
const opts = { category: "other", visibility: "client_visible" };
const calls = (method: string) => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === method);

describe("inspector documents latch", () => {
    it("stores ONE file for two same-frame uploads", async () => {
        await mount();
        act(() => { docs.props!.onUpload(file, opts); docs.props!.onUpload(file, opts); });
        await settle();
        expect(calls("PUT")).toHaveLength(1);
    });

    it("CONTROL - a later upload goes through", async () => {
        await mount();
        act(() => { docs.props!.onUpload(file, opts); });
        await settle();
        act(() => { docs.props!.onUpload(file, opts); });
        await settle();
        expect(calls("PUT")).toHaveLength(2);
    });

    it("deletes a document ONCE for two same-frame deletes", async () => {
        await mount();
        act(() => { docs.props!.onDelete("doc-1"); docs.props!.onDelete("doc-1"); });
        await settle();
        expect(calls("DELETE")).toHaveLength(1);
    });

    it("CONTROL - a later delete goes through", async () => {
        await mount();
        act(() => { docs.props!.onDelete("doc-1"); });
        await settle();
        act(() => { docs.props!.onDelete("doc-1"); });
        await settle();
        expect(calls("DELETE")).toHaveLength(2);
    });
});
