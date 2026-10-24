// @vitest-environment happy-dom
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub, useLoaderData, useRevalidator } from "react-router";
import { useFieldDataSource, useFieldSlots } from "@core/field-ui/context";
import type { FieldDataSource, FieldHostSlots } from "@core/field-ui/data-source";
import { loaderPayload } from "~/lib/field/web-editor-data.fixtures";
import type { EditorLoaderData } from "~/lib/field/web-editor-data";
import { OutboundVerificationProvider } from "~/components/OutboundVerification";
import { m as appMessages } from "~/paraglide/messages";
import { WebFieldHost } from "./WebFieldHost";

type OnSeen = (ds: FieldDataSource, slots: FieldHostSlots) => void;

/** Hands the live data source and slots to the test on every render. */
function Probe({ onSeen }: { onSeen: OnSeen }) {
    const ds = useFieldDataSource();
    const slots = useFieldSlots();
    onSeen(ds, slots);
    return <p>probe</p>;
}

/** A host route whose payload comes from a (re-runnable) loader. */
function routeWithLoader(load: () => EditorLoaderData, onSeen: OnSeen) {
    function Page() {
        const editor = useLoaderData() as EditorLoaderData;
        return (
            <WebFieldHost editor={editor}>
                <Probe onSeen={onSeen} />
            </WebFieldHost>
        );
    }
    return createRoutesStub([{ path: "/", loader: load, Component: Page }]);
}

function mount(editor: EditorLoaderData | null, onSeen: OnSeen) {
    const Stub = createRoutesStub([
        { path: "/", Component: () => <WebFieldHost editor={editor}><Probe onSeen={onSeen} /></WebFieldHost> },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("WebFieldHost", () => {
    it("renders its children and gives them a data source whose session reflects the loader", async () => {
        let ds: FieldDataSource | null = null;
        mount(loaderPayload({ tenantSlug: "acme", videoProvider: "stream", streamCustomerSubdomain: "cust", collabEditing: true }), (d) => { ds = d; });
        await screen.findByText("probe");
        const session = ds!.session();
        expect(session).toMatchObject({ tenantSlug: "acme", videoProvider: "stream", streamCustomerSubdomain: "cust", collabEditing: true });
        // The editor routes carry no session context today: every display value is its fallback.
        expect(session).toMatchObject({ locale: "en-US", timeZone: "UTC", dateFormat: "us", timeFormat: "12h", userId: null, role: "" });
        expect(ds!.platform).toBe("web");
    });

    it("load() returns the converted loader data", async () => {
        let ds: FieldDataSource | null = null;
        mount(loaderPayload({ inspection: { id: "i7", propertyAddress: "9 Elm" }, resultId: "r7" }), (d) => { ds = d; });
        await screen.findByText("probe");
        const data = await ds!.load("i7");
        expect(data.inspection).toMatchObject({ id: "i7", propertyAddress: "9 Elm" });
        expect(data.resultId).toBe("r7");
    });

    it("passes a layout observer that remembers the band in the layout cookie, and only when it changes", async () => {
        let slots: FieldHostSlots | null = null;
        mount(loaderPayload(), (_d, s) => { slots = s; });
        await screen.findByText("probe");
        expect(typeof slots!.onLayoutObserved).toBe("function");
        const jar = vi.spyOn(document, "cookie", "set");
        slots!.onLayoutObserved!("phone");
        slots!.onLayoutObserved!("phone");
        expect(document.cookie).toContain("ih-editor-layout=phone");
        expect(jar).toHaveBeenCalledTimes(1);
        slots!.onLayoutObserved!("tablet");
        expect(jar).toHaveBeenCalledTimes(2);
        jar.mockRestore();
    });

    it("passes the theme and pdf slots through", async () => {
        let slots: FieldHostSlots | null = null;
        mount(loaderPayload(), (_d, s) => { slots = s; });
        await screen.findByText("probe");
        expect(typeof slots!.renderThemeControl).toBe("function");
        expect(slots!.pdf).toMatchObject({ busy: false, error: null });
        expect(slots!.pdf!.actionLabel("Preview")).toBe("Preview");
    });

    it("passes the human check and the unsaved-changes guard through as slots, with stable identity", async () => {
        const seen: FieldHostSlots[] = [];
        mount(loaderPayload(), (_d, s) => { seen.push(s); });
        await screen.findByText("probe");
        const slots = seen[seen.length - 1]!;
        expect(typeof slots.renderUnsavedGuard).toBe("function");
        // No human check is mounted around this host, so the check answers that the person may go on.
        await expect(slots.ensureHuman!()).resolves.toBe(true);
        expect(seen.every((s) => s.ensureHuman === seen[0].ensureHuman)).toBe(true);
    });

    it("the human check slot is the check mounted around the host: its dialog opens and a cancel there answers false", async () => {
        let slots: FieldHostSlots | null = null;
        const Stub = createRoutesStub([{
            path: "/",
            Component: () => (
                <OutboundVerificationProvider windowOpen siteKey="test-site-key">
                    <WebFieldHost editor={loaderPayload()}><Probe onSeen={(_d, s) => { slots = s; }} /></WebFieldHost>
                </OutboundVerificationProvider>
            ),
        }]);
        render(<Stub initialEntries={["/"]} />);
        await screen.findByText("probe");
        let answer: boolean | null = null;
        await act(async () => { void slots!.ensureHuman!().then((ok) => { answer = ok; }); });
        // The default context would have answered true without a dialog; reaching the real provider shows it.
        const cancel = await screen.findByRole("button", { name: appMessages.outbound_verify_cancel() });
        expect(answer).toBeNull();
        await act(async () => { cancel.click(); });
        await waitFor(() => expect(answer).toBe(false));
    });

    it("keeps the data source identity across a revalidation and serves the NEW loader data", async () => {
        const seen: FieldDataSource[] = [];
        let n = 0;
        let revalidate: () => Promise<void> = () => Promise.resolve();
        const Trigger = () => {
            const r = useRevalidator();
            useEffect(() => { revalidate = () => Promise.resolve(r.revalidate()); });
            return null;
        };
        // The revalidator trigger lives in its own tiny route child so the host re-renders on its state.
        function WithTrigger() {
            const editor = useLoaderData() as EditorLoaderData;
            return <WebFieldHost editor={editor}><Probe onSeen={(d) => { seen.push(d); }} /><Trigger /></WebFieldHost>;
        }
        const R = createRoutesStub([{ path: "/", loader: () => { n += 1; return loaderPayload({ tenantSlug: `gen-${n}` }); }, Component: WithTrigger }]);
        render(<R initialEntries={["/"]} />);
        await screen.findByText("probe");
        const first = seen[0]!;
        const rendersBefore = seen.length;
        await act(async () => { await revalidate(); });
        await waitFor(() => expect(n).toBeGreaterThanOrEqual(2));
        // Loader data AND revalidator state both changed, and the host re-rendered for them.
        await waitFor(() => expect(seen.length).toBeGreaterThan(rendersBefore));
        expect(seen.every((d) => Object.is(d, first))).toBe(true);
        await waitFor(() => expect(first.session().tenantSlug).toBe(`gen-${n}`));
        await expect(first.load("insp-1")).resolves.toMatchObject({ inspection: { id: "insp-1" } });
    });

    it("reload() asks the router to revalidate", async () => {
        let n = 0;
        let ds: FieldDataSource | null = null;
        const R = routeWithLoader(() => { n += 1; return loaderPayload(); }, (d) => { ds = d; });
        render(<R initialEntries={["/"]} />);
        await screen.findByText("probe");
        expect(n).toBe(1);
        act(() => ds!.reload());
        await waitFor(() => expect(n).toBe(2));
    });

    it("exit() navigates to the inspections list", async () => {
        let ds: FieldDataSource | null = null;
        const Stub = createRoutesStub([
            { path: "/", Component: () => <WebFieldHost editor={loaderPayload()}><Probe onSeen={(d) => { ds = d; }} /></WebFieldHost> },
            { path: "/inspections", Component: () => <p>list page</p> },
        ]);
        render(<Stub initialEntries={["/"]} />);
        await screen.findByText("probe");
        act(() => ds!.exit());
        await screen.findByText("list page");
    });

    it("serves the real collab connector, and a media uploader that answers instead of throwing", async () => {
        let ds: FieldDataSource | null = null;
        mount(loaderPayload(), (d) => { ds = d; });
        await screen.findByText("probe");
        expect(typeof ds!.collab.connect).toBe("function");
        // No IndexedDB here, so a purge has nothing to do and says nothing; it must not reject.
        await expect(ds!.collab.purge("i")).resolves.toBeUndefined();
        // With no results document a crop cannot be addressed: a not-ok answer, no request.
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const uploader = ds!.media.uploader("i", null);
        const crop = { aspect: "free", orientation: "landscape" as const, x: 0, y: 0, width: 1, height: 1 };
        await expect(
            uploader.upload({
                kind: "crop", pendingId: "p", inspectionId: "i", createdAt: 1, blob: new Blob(["c"]),
                meta: { findingKey: "_default:s:i", itemId: "i", photoIndex: 0, photoKey: "k", crop },
            }),
        ).resolves.toMatchObject({ ok: false });
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it("on the template host, load and execute reject clearly and the session still works", async () => {
        let ds: FieldDataSource | null = null;
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        mount(null, (d) => { ds = d; });
        await screen.findByText("probe");
        await expect(ds!.load("any")).rejects.toThrow(/no inspection/);
        await expect(ds!.execute("any", { type: "complete" } as never)).rejects.toThrow(/no inspection/);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(ds!.session()).toMatchObject({ tenantSlug: null, videoProvider: "r2", collabEditing: false, locale: "en-US" });
        fetchSpy.mockRestore();
    });
});
