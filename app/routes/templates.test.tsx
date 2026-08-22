// @vitest-environment happy-dom
/**
 * `/templates` — one front door for bringing a template in.
 *
 * The page used to own a second, private import: a modal with a textarea you
 * pasted an export into. It answered the same questions the wizard asks —
 * which product, what it should be called, what the rating words mean — but in
 * a form that could only ever guess the first one, and it published nothing a
 * second entrance could reuse.
 *
 * So the assertions here are about ADDRESSES, not about buttons rendering:
 *
 *   1. every import control on this page resolves to the SAME address, and
 *      that address is the wizard's templates entry. Asserted as a set, so a
 *      page that sends the header one way and the empty state another fails
 *      even though both are links;
 *   2. no textarea remains anywhere on the page, with a positive control that
 *      the page really rendered — an empty document also has no textarea;
 *   3. the create control is still a BUTTON. Without it, "everything is a
 *      link" would satisfy assertion 1 while having deleted the wrong half.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import TemplatesPage from "~/routes/templates";

/** The one address every import control on this page must resolve to. */
const FRONT_DOOR = "/settings/imports?intent=templates.create";

interface TemplateFixture {
    id: string;
    name: string;
    schema: { schemaVersion: number; sections: unknown[] };
    createdAt: string;
    updatedAt: string;
}

const A_TEMPLATE: TemplateFixture = {
    id: "tpl-1",
    name: "Residential Full",
    schema: { schemaVersion: 2, sections: [] },
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
};

function renderPage(opts: { templates?: TemplateFixture[] } = {}) {
    const templates = opts.templates ?? [];
    const context = {
        branding: { defaultLocale: "en-US", defaultTimezone: "UTC" },
        user: {
            capabilities: {
                templateCreate: true,
                templateImport: true,
                templateDelete: true,
            },
        },
        deployment: { hasAssistedMigration: false },
    };
    const Stub = createRoutesStub([
        {
            // The id `useSessionContext` reads through `useRouteLoaderData`.
            id: "routes/auth-layout",
            path: "/",
            loader: () => ({ context }),
            Component: () => <Outlet />,
            children: [
                {
                    path: "templates",
                    Component: TemplatesPage,
                    loader: () => ({
                        templates,
                        meta: {
                            total: templates.length,
                            page: 1,
                            pageSize: 50,
                            totalPages: 1,
                        },
                        q: "",
                        token: "",
                    }),
                },
            ],
        },
    ]);
    return render(<Stub initialEntries={["/templates"]} />);
}

/** Every import control on the page, whatever view it is rendered from. */
async function importLinks(): Promise<HTMLElement[]> {
    // Matched on the accessible name rather than the href, so a control that
    // points somewhere else is a FAILURE here rather than an absence.
    await screen.findByRole("heading", { name: /Inspection Templates/i });
    return screen.getAllByRole("link", { name: /import/i });
}

describe("/templates — one front door", () => {
    it("sends the header's import control to the wizard, not to a modal", async () => {
        renderPage({ templates: [A_TEMPLATE] });

        const links = await importLinks();
        expect(links.length).toBeGreaterThan(0);
        expect(new Set(links.map((a) => a.getAttribute("href")))).toEqual(
            new Set([FRONT_DOOR]),
        );
    });

    it("sends the EMPTY STATE's import control to the same address", async () => {
        // A second entrance is where the two used to drift: the header opened
        // the modal and so did this one, and either could have been converted
        // alone while the page still looked finished.
        renderPage({ templates: [] });

        const links = await importLinks();
        // Header + empty state, so more than one — the set assertion below is
        // what makes them agree rather than merely both existing.
        expect(links.length).toBeGreaterThan(1);
        expect(new Set(links.map((a) => a.getAttribute("href")))).toEqual(
            new Set([FRONT_DOOR]),
        );
    });

    it("keeps the CARD view's import control on the same address — the third entrance", async () => {
        const { container } = renderPage({ templates: [] });
        const cards = await screen.findByRole("button", { name: /^Cards$/i });
        cards.click();

        const links = within(container).getAllByRole("link", { name: /import/i });
        expect(links.length).toBeGreaterThan(1);
        expect(new Set(links.map((a) => a.getAttribute("href")))).toEqual(
            new Set([FRONT_DOOR]),
        );
    });

    it("opens no paste form when the import control is used", async () => {
        // Written as a CLICK rather than as "the document contains no
        // textarea": the paste modal mounted its textarea only while open, so
        // the static form of this assertion is green against the very code it
        // is supposed to reject. Verified — it passed on its first run before
        // any of this task's changes existed.
        renderPage({ templates: [A_TEMPLATE] });

        // POSITIVE CONTROL: the page really rendered, and there really is an
        // import control to use. An empty document opens no paste form either.
        expect(await screen.findByRole("heading", { name: /Inspection Templates/i })).toBeTruthy();
        expect(screen.getByText("Residential Full")).toBeTruthy();
        const controls = [
            ...screen.queryAllByRole("button", { name: /import/i }),
            ...screen.queryAllByRole("link", { name: /import/i }),
        ];
        expect(controls.length).toBeGreaterThan(0);

        fireEvent.click(controls[0]);

        // Queried off the document, not the container: a modal renders through
        // a portal, and a container-scoped query would miss the thing this is
        // looking for.
        expect(document.querySelectorAll("textarea")).toHaveLength(0);
        expect(screen.queryByText(/Paste your/i)).toBeNull();
    });

    it("still opens CREATE as a button — the control that must NOT have become a link", async () => {
        renderPage({ templates: [A_TEMPLATE] });

        const create = await screen.findByRole("button", { name: /New Template/i });
        expect(create.tagName).toBe("BUTTON");
        expect(screen.queryByRole("link", { name: /New Template/i })).toBeNull();
    });
});
