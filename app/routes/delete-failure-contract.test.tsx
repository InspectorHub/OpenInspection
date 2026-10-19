// @vitest-environment happy-dom
/**
 * One contract for every page that deletes through an action: a refused delete
 * (`{ ok: false }`) leaves the row where it is AND says so in an alert; a
 * confirmed one (`{ ok: true }`) re-reads the page and the row is gone, with no
 * alert. A refusal used to be silent: the row stayed and the control looked dead.
 *
 * Each case drives the page's own delete flow against a stub action, so a page
 * that stops reading the answer fails here.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import DefectCategoriesPage from "~/routes/library/defect-categories";
import RatingSystemsPage from "~/routes/library/rating-systems";
import RepairItemsPage from "~/routes/repair-items";
import SettingsContractorTypes from "~/routes/settings-contractor-types";
import TeamPage from "~/routes/team";
import ContactsPage from "~/routes/contacts";
import TemplatesPage from "~/routes/templates";

afterEach(cleanup);

type Page = {
    path: string; Component: () => React.ReactElement; data: (gone: boolean) => unknown; row: string; intent: string;
    /** Steps that make the row visible (a tab to open), run before it is looked for. */
    reveal?: () => Promise<void>;
    trigger: () => Promise<void>;
    /** Resource routes the page loads beside its own loader. */
    resources?: Record<string, unknown>;
};

const click = (el: HTMLElement) => fireEvent.click(el);
/** The confirm button of the open dialog: the last button in it (Cancel comes first). */
const confirmInDialog = async () => {
    const dialog = await screen.findByRole("dialog");
    const buttons = within(dialog).getAllByRole("button").filter((b) => !/close|✕/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
    click(buttons.at(-1)!);
};
const named = async (name: RegExp) => click(await screen.findByRole("button", { name }));

const DEFECT = { id: "c1", name: "Safety hazard", color: "#cc0000", drivesSummary: true, sortOrder: 1, isSeed: false };
const SYSTEM = { id: "s1", name: "Three level", slug: "three", description: null, isDefault: false, isSeed: false, levels: [] };
const ITEM = { id: "ri-1", name: "Replace flashing", category: null, severity: "significant", defaultRepairSummary: "x", recommendedContractorTypeId: null };
const CTYPE = { id: "ct1", name: "Roofer", tradeSlug: null, sortOrder: 0 };
const INVITE = { id: "id-1", name: null, email: "invitee@seed.test", role: "inspector", status: "pending", lastActiveAt: null, token: "11111111-aaaa-4aaa-8aaa-111111111111", inviteLink: "https://x.test/join?token=1", expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() };
const CONTACT = { id: "c1", name: "Rosa Lindqvist", type: "agent", email: "rosa@example.com", phone: null, agency: "Northside Realty", inspectionCount: 4, referralCount: 3 };
const TEMPLATE = { id: "tpl-1", name: "Residential Full", schema: { schemaVersion: 2, sections: [] }, createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z" };

const PAGES: Record<string, Page> = {
    "library/defect-categories": {
        path: "library/defect-categories", Component: DefectCategoriesPage, row: "Safety hazard", intent: "delete",
        data: (gone) => ({ categories: gone ? [] : [DEFECT], loadFailed: false }),
        trigger: async () => { await named(/^delete$/i); await named(/confirm/i); },
    },
    "library/rating-systems": {
        path: "library/rating-systems", Component: RatingSystemsPage, row: "Three level", intent: "delete",
        data: (gone) => ({ systems: gone ? [] : [SYSTEM], loadFailed: false }),
        trigger: async () => { await named(/^delete$/i); await named(/confirm/i); },
    },
    "repair-items": {
        path: "library/repair-items", Component: RepairItemsPage, row: "Replace flashing", intent: "delete",
        data: (gone) => ({ items: gone ? [] : [ITEM], contractorTypes: [], loadFailed: false }),
        trigger: async () => { await named(/^delete$/i); await confirmInDialog(); },
    },
    "settings/contractor-types": {
        path: "settings/contractor-types", Component: SettingsContractorTypes, row: "Roofer", intent: "delete",
        data: (gone) => ({ types: gone ? [] : [CTYPE] }),
        trigger: async () => { await named(/^delete roofer$/i); await confirmInDialog(); },
    },
    "team (cancel invitation)": {
        path: "team", Component: TeamPage, row: "invitee@seed.test", intent: "cancel-invite",
        data: (gone) => ({ members: gone ? [] : [INVITE], templates: [], canManage: true, loadFailed: false }),
        reveal: async () => { await named(/Pending Invites/i); },
        trigger: async () => {
            click((await screen.findAllByRole("button")).find((b) => /cancel invit/i.test(b.textContent ?? ""))!);
            await confirmInDialog();
        },
    },
    contacts: {
        path: "contacts", Component: ContactsPage, row: "Rosa Lindqvist", intent: "delete",
        data: (gone) => ({ contacts: gone ? [] : [CONTACT], filterType: "" }),
        resources: { "resources/contact-access": { access: [], archiveRevokesAccess: false } },
        trigger: async () => { await named(/^archive$/i); await confirmInDialog(); },
    },
    templates: {
        path: "templates", Component: TemplatesPage, row: "Residential Full", intent: "delete",
        data: (gone) => ({ templates: gone ? [] : [TEMPLATE], meta: { total: gone ? 0 : 1, page: 1, pageSize: 50, totalPages: 1 }, q: "", token: "" }),
        trigger: async () => { await named(/^delete$/i); await confirmInDialog(); },
    },
};

function mount(page: Page, answer: { ok: boolean }) {
    let gone = false;
    const context = {
        branding: { defaultLocale: "en-US", defaultTimezone: "UTC" },
        user: { role: "owner", capabilities: { templateCreate: true, templateEdit: true, templateDelete: true, templateImport: true, deleteInspection: true } },
        deployment: { hasAssistedMigration: false },
    };
    const Stub = createRoutesStub([
        {
            id: "routes/auth-layout",
            path: "/",
            loader: () => ({ context }),
            Component: () => <Outlet />,
            children: [
                {
                    path: page.path,
                    Component: page.Component,
                    loader: () => page.data(gone),
                    action: async ({ request }) => {
                        const intent = String((await request.formData()).get("intent"));
                        if (intent === "preflight") return { ok: true, intent, id: "ct1", comments: 0 };
                        if (answer.ok) gone = true;
                        return { ok: answer.ok, intent: page.intent };
                    },
                },
                ...Object.entries(page.resources ?? {}).map(([path, body]) => ({ path, loader: () => body })),
            ],
        },
    ]);
    return render(<Stub initialEntries={[`/${page.path}`]} />);
}

describe.each(Object.entries(PAGES))("%s — delete outcome", (_name, page) => {
    it("a refused delete keeps the row and shows an alert", async () => {
        mount(page, { ok: false });
        await page.reveal?.();
        await screen.findByText(page.row);
        await page.trigger();
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toMatch(/could not be|try again/i);
        expect(screen.getByText(page.row)).toBeTruthy();
    });

    it("CONTROL: a confirmed delete re-reads the page, the row is gone and there is no alert", async () => {
        mount(page, { ok: true });
        await page.reveal?.();
        await screen.findByText(page.row);
        await page.trigger();
        await waitFor(() => expect(screen.queryByText(page.row)).toBeNull());
        expect(screen.queryByRole("alert")).toBeNull();
    });
});
