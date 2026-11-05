// @vitest-environment happy-dom
/**
 * The publish-state banner above the editor: what it says in each state, the one step that goes with it, and that the
 * step is written once however fast it is clicked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { m } from "~/paraglide/messages";
import { ReportPublishBanner, type ReportPublishState } from "./ReportPublishBanner";

afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

interface Harness {
    intents: string[];
    loads: () => number;
    openPublish: ReturnType<typeof vi.fn>;
}

function mount(state: ReportPublishState, opts: { locked?: boolean; result?: unknown } = {}): Harness {
    const intents: string[] = [];
    let loadCount = 0;
    const openPublish = vi.fn();
    const Stub = createRoutesStub([
        {
            path: "/",
            loader: () => { loadCount += 1; return null; },
            action: async ({ request }) => {
                intents.push(String((await request.formData()).get("intent")));
                return opts.result ?? { ok: true, intent: "edit-again" };
            },
            Component: () => <ReportPublishBanner {...state} locked={opts.locked ?? false} openPublish={openPublish} />,
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
    return { intents, loads: () => loadCount, openPublish };
}

const PUBLISHED: ReportPublishState = { publishedVersionNumber: 3, editingAgain: false, readOnly: true };
const EDITING: ReportPublishState = { publishedVersionNumber: 3, editingAgain: true, readOnly: false };
const DRAFT: ReportPublishState = { publishedVersionNumber: null, editingAgain: false, readOnly: false };

describe("ReportPublishBanner states", () => {
    it("published: says which version clients see and offers Edit and republish", async () => {
        mount(PUBLISHED);
        await settle();
        expect(screen.getByText(m.editor_publish_banner_published({ version: 3 }))).toBeTruthy();
        expect(screen.getByRole("button", { name: m.editor_publish_banner_edit() })).toBeTruthy();
    });

    it("editing again: says clients still see the last version and offers Publish update", async () => {
        const h = mount(EDITING);
        await settle();
        expect(screen.getByText(m.editor_publish_banner_editing({ version: 3 }))).toBeTruthy();
        expect(screen.queryByRole("button", { name: m.editor_publish_banner_edit() })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: m.editor_publish_banner_publish_update() }));
        expect(h.openPublish).toHaveBeenCalledTimes(1);
    });

    it("locked from elsewhere: warns and offers Reload", async () => {
        mount(EDITING, { locked: true });
        await settle();
        expect(screen.getByText(m.editor_publish_banner_locked())).toBeTruthy();
        expect(screen.getByRole("button", { name: m.editor_publish_banner_reload() })).toBeTruthy();
    });

    it("(control) a draft shows nothing", async () => {
        const { container } = render(<div />);
        mount(DRAFT);
        await settle();
        expect(screen.queryByRole("button")).toBeNull();
        expect(container.textContent).toBe("");
    });
});

describe("Edit and republish", () => {
    it("posts intent=edit-again and reloads the editor data", async () => {
        const h = mount(PUBLISHED);
        await settle();
        const before = h.loads();
        fireEvent.click(screen.getByRole("button", { name: m.editor_publish_banner_edit() }));
        await settle();
        expect(h.intents).toEqual(["edit-again"]);
        expect(h.loads()).toBeGreaterThan(before);
    });

    it("writes once for two same-frame submits", async () => {
        const h = mount(PUBLISHED);
        await settle();
        const form = screen.getByRole("button", { name: m.editor_publish_banner_edit() }).closest("form") as HTMLFormElement;
        act(() => { fireEvent.submit(form); fireEvent.submit(form); });
        await settle();
        expect(h.intents).toEqual(["edit-again"]);
    });

    it("shows the server's refusal", async () => {
        const h = mount(PUBLISHED, { result: { ok: false, intent: "edit-again", error: "Nope, try later" } });
        await settle();
        fireEvent.click(screen.getByRole("button", { name: m.editor_publish_banner_edit() }));
        await settle();
        expect(h.intents).toEqual(["edit-again"]);
        expect(screen.getByText("Nope, try later")).toBeTruthy();
    });
});
