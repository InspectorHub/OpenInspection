// @vitest-environment happy-dom
/**
 * Client portal document upload / delete same-frame guards: the busy flag only lands after a render, so two
 * drops in ONE frame must store the file once, and two deletes of the same document must reach the API once
 * (the second would answer 404 and show a false "delete failed").
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";

type SlotProps = {
    onUpload: (f: File, o: { category: string; visibility: string }) => void;
    onDelete: (id: string) => void;
};
const slot = vi.hoisted(() => ({ props: null as null | SlotProps }));
vi.mock("~/components/portal/hub/HubSectionSlot", () => ({
    HubSectionSlot: (p: SlotProps) => { slot.props = p; return null; },
}));
vi.mock("~/components/portal/ClientPortalHub", () => ({
    default: ({ sectionSlot }: { sectionSlot: React.ReactNode }) => <div>{sectionSlot}</div>,
    hubSectionNavHref: () => "/",
}));

import PortalInspection from "./portal-inspection";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const loaderData = {
    overview: {}, ctx: { tenant: "acme", inspectionId: "insp-1", token: "tok", signerToken: null }, section: "documents",
    brand: {}, documents: [], report: null, progress: null, repair: null, invoice: null, agreement: null, agentReport: null,
    notices: { notices: [], unread: 0 }, notifications: null,
};
const res = (ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => ({}) }) as unknown as Response;

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
    const Stub = createRoutesStub([{ path: "/", Component: PortalInspection, loader: () => loaderData }]);
    render(<Stub initialEntries={["/"]} />);
    await settle();
}
const file = new File(["x"], "a.pdf", { type: "application/pdf" });
const opts = { category: "other", visibility: "client_visible" };
const calls = (method: string) => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === method);

describe("client portal documents latch", () => {
    it("stores ONE file for two same-frame uploads", async () => {
        await mount();
        act(() => { slot.props!.onUpload(file, opts); slot.props!.onUpload(file, opts); });
        await settle();
        expect(calls("PUT")).toHaveLength(1);
    });

    it("CONTROL - a later upload goes through", async () => {
        await mount();
        act(() => { slot.props!.onUpload(file, opts); });
        await settle();
        act(() => { slot.props!.onUpload(file, opts); });
        await settle();
        expect(calls("PUT")).toHaveLength(2);
    });

    it("deletes a document ONCE for two same-frame deletes", async () => {
        await mount();
        act(() => { slot.props!.onDelete("doc-1"); slot.props!.onDelete("doc-1"); });
        await settle();
        expect(calls("DELETE")).toHaveLength(1);
    });

    it("CONTROL - a later delete goes through", async () => {
        await mount();
        act(() => { slot.props!.onDelete("doc-1"); });
        await settle();
        act(() => { slot.props!.onDelete("doc-1"); });
        await settle();
        expect(calls("DELETE")).toHaveLength(2);
    });
});
