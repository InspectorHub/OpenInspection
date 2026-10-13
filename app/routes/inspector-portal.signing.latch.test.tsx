// @vitest-environment happy-dom
/**
 * Send-agreement emails every signer and inspector-sign appends a row to the e-sign audit log, so a repeat is
 * visible to other people. The modal's busy flag only lands after a render: two triggers in ONE frame must
 * reach the route action once, and a later trigger after the action settles must go through.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

type SendProps = { onSend: (p: unknown) => void };
type SigProps = { onSubmit: (d: string) => void };
type ListProps = { onPreSign: (id: string) => void };
const mocks = vi.hoisted(() => ({
    send: null as null | { onSend: (p: unknown) => void },
    sig: null as null | { onSubmit: (d: string) => void },
    list: null as null | { onPreSign: (id: string) => void },
}));
vi.mock("~/components/agreements/SendAgreementModal", () => ({
    SendAgreementModal: (p: SendProps) => { mocks.send = p; return null; },
}));
vi.mock("~/components/SignaturePad", () => ({
    SignaturePad: (p: SigProps) => { mocks.sig = p; return null; },
}));
vi.mock("~/components/inspector-portal/SigningRequests", () => ({
    SigningRequests: (p: ListProps) => { mocks.list = p; return null; },
}));

import InspectionHubPage from "./inspector-portal";

let intents: string[] = [];
let release: () => void = () => {};
beforeEach(() => {
    intents = [];
    release = () => {};
    mocks.send = null;
    mocks.sig = null;
});
afterEach(cleanup);

function loaderData() {
    return {
        hub: {
            inspection: {
                id: "insp1", status: "completed", reportStatus: "in_progress", paymentRequired: false, agreementRequired: false,
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
        smsConsent: null, reinspectCandidates: [], canPublishCap: false, canViewCommunication: false, documents: [],
        people: [], roleProfiles: [], isAdmin: false, versions: [], members: [], serviceCatalog: [],
        referralSources: [], visits: [], visitTypes: [], suggestedTypeIds: [], role: "owner", statutoryForm: { available: false },
    };
}

async function mount() {
    const Stub = createRoutesStub([
        {
            path: "/inspections/:id",
            Component: InspectionHubPage,
            loader: () => loaderData(),
            action: async ({ request }) => {
                intents.push(String((await request.formData()).get("intent")));
                await new Promise<void>((resolve) => { release = resolve; });
                return { ok: false, intent: "x" };
            },
        },
    ]);
    render(<Stub initialEntries={["/inspections/insp1"]} />);
    await waitFor(() => expect(mocks.send).not.toBeNull());
}

const payload = { agreementId: "a1", completionPolicy: "all", signers: [{ name: "A", email: "a@x.test", role: "client" }] };
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("inspector-portal send-agreement", () => {
    it("sends the agreement once for two same-frame sends, and again after it settles", async () => {
        await mount();
        act(() => { mocks.send!.onSend(payload); mocks.send!.onSend(payload); });
        await waitFor(() => expect(intents).toEqual(["send-agreement"]));
        await tick();
        expect(intents).toEqual(["send-agreement"]);
        await act(async () => { release(); });
        await tick();
        act(() => { mocks.send!.onSend(payload); });
        await waitFor(() => expect(intents).toEqual(["send-agreement", "send-agreement"]));
        await act(async () => { release(); });
    });
});

describe("inspector-portal inspector-sign", () => {
    async function openPad() {
        await mount();
        act(() => { mocks.list!.onPreSign("env1"); });
        await waitFor(() => expect(mocks.sig).not.toBeNull());
    }

    it("signs once for two same-frame submits, and again after it settles", async () => {
        await openPad();
        act(() => { mocks.sig!.onSubmit("data:image/png;base64,AAA"); mocks.sig!.onSubmit("data:image/png;base64,AAA"); });
        await waitFor(() => expect(intents).toEqual(["inspector-sign"]));
        await tick();
        expect(intents).toEqual(["inspector-sign"]);
        await act(async () => { release(); });
        await tick();
        act(() => { mocks.sig!.onSubmit("data:image/png;base64,AAA"); });
        await waitFor(() => expect(intents).toEqual(["inspector-sign", "inspector-sign"]));
        await act(async () => { release(); });
    });
});
