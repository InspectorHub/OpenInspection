// @vitest-environment happy-dom
/**
 * `/settings/imports` — the list of import runs, and the entry points that
 * start one.
 *
 * Every assertion here is written against state that ONLY this page's own
 * behaviour produces. "A table renders" is true of any page with a table, so
 * the four things pinned instead are:
 *
 *   1. a ROW belongs to the run it came from — its intent, its source, its
 *      status and its link are read back together, and the other row is
 *      checked NOT to carry them, because a page that renders the same row
 *      twice passes every single-row assertion;
 *   2. the empty state appears when and only when there are no runs (the
 *      populated case is asserted to NOT show it — an empty state that is
 *      always mounted is the shape this catches);
 *   3. each entry point goes somewhere DIFFERENT, asserted as a set of three
 *      distinct hrefs rather than three separate "a link exists" checks;
 *   4. the submit control states its own blocking condition as a sentence
 *      naming the first thing to fix reading down the form, and the sentence
 *      CHANGES as each condition is met. A disabled button asserted only as
 *      `disabled` would pass while saying nothing.
 *
 * The assisted entry point is gated on a deployment capability, so it gets a
 * positive control in both directions plus the fail-closed case where the
 * session carries no `deployment` block at all — the shape that replaced
 * `/library` with "Unexpected Application Error!" once already.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import SettingsImports from "~/routes/settings-imports";

interface RunFixture {
    id: string;
    intent: string;
    vendor: string;
    status: string;
    createdAt: string;
    expiresAt: string | null;
}

const TEMPLATES_RUN: RunFixture = {
    id: "batch-templates",
    intent: "templates.create",
    vendor: "spectora",
    status: "staged",
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: "2026-09-01T10:00:00.000Z",
};

const CONTACTS_RUN: RunFixture = {
    id: "batch-contacts",
    intent: "contacts.import",
    vendor: "csv",
    status: "applied",
    createdAt: "2026-08-14T10:00:00.000Z",
    expiresAt: null,
};

function renderPage(opts: {
    items?: RunFixture[];
    forbidden?: boolean;
    hasAssistedMigration?: boolean;
    /** Omit the deployment block entirely — an older cached session payload. */
    noDeploymentBlock?: boolean;
    entry?: string;
} = {}) {
    const context = opts.noDeploymentBlock
        ? { branding: { defaultLocale: "en-US", defaultTimezone: "UTC" }, user: {} }
        : {
            branding: { defaultLocale: "en-US", defaultTimezone: "UTC" },
            user: {},
            deployment: { hasAssistedMigration: opts.hasAssistedMigration ?? false },
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
                    path: "settings/imports",
                    Component: SettingsImports,
                    loader: () => ({
                        forbidden: opts.forbidden ?? false,
                        items: opts.items ?? [],
                    }),
                },
            ],
        },
    ]);
    return render(<Stub initialEntries={[opts.entry ?? "/settings/imports"]} />);
}

/**
 * The row whose cells contain `text`, so a row is read as one unit.
 *
 * Scoped to the table on purpose: "Templates" and "Contacts" are also the
 * names of two entry points, and a page-wide lookup would find those instead
 * and quietly assert nothing about the list.
 */
async function rowContaining(text: string): Promise<HTMLElement> {
    const table = await screen.findByRole("table");
    const cell = within(table).getByText(text);
    const row = cell.closest("tr");
    if (!row) throw new Error(`"${text}" is not inside a table row`);
    return row;
}

describe("settings → imports: the list", () => {
    it("reads each row back as the run it came from", async () => {
        renderPage({ items: [TEMPLATES_RUN, CONTACTS_RUN] });

        const templates = await rowContaining("Templates");
        expect(within(templates).getByText("spectora")).toBeTruthy();
        expect(within(templates).getByText("Ready to review")).toBeTruthy();
        expect(within(templates).getByRole("link", { name: "Open" }).getAttribute("href"))
            .toBe("/settings/imports/batch-templates");

        const contacts = await rowContaining("Contacts");
        expect(within(contacts).getByText("csv")).toBeTruthy();
        expect(within(contacts).getByText("Imported")).toBeTruthy();
        expect(within(contacts).getByRole("link", { name: "Open" }).getAttribute("href"))
            .toBe("/settings/imports/batch-contacts");

        // The negative half: neither row wears the other's state. A page that
        // rendered one run twice, or reused a single status for the whole
        // table, satisfies both blocks above and fails here.
        expect(within(templates).queryByText("Imported")).toBeNull();
        expect(within(templates).queryByText("csv")).toBeNull();
        expect(within(contacts).queryByText("Ready to review")).toBeNull();
        expect(within(contacts).queryByText("spectora")).toBeNull();
    });

    it("keeps a run's retention date on its own row, and says so when there is none", async () => {
        renderPage({ items: [TEMPLATES_RUN, CONTACTS_RUN] });

        const templates = await rowContaining("Templates");
        expect(within(templates).getByText(/Sep 1, 2026/)).toBeTruthy();

        // `expiresAt: null` is a real answer — a run already applied is kept by
        // a different rule — so it renders a dash rather than an empty cell.
        const contacts = await rowContaining("Contacts");
        expect(within(contacts).queryByText(/Sep 1, 2026/)).toBeNull();
        expect(within(contacts).getByText("—")).toBeTruthy();
    });

    it("shows the empty state only when there are no runs", async () => {
        renderPage({ items: [] });
        expect(await screen.findByText("Nothing imported yet")).toBeTruthy();
    });

    it("does NOT show the empty state once a run exists", async () => {
        // The positive control for the test above: an empty state that is
        // always mounted passes that one and fails this one.
        renderPage({ items: [TEMPLATES_RUN] });
        // The table, not the word "Templates" — that word is on the page twice
        // once a run exists, because it also names an entry point.
        await screen.findByRole("table");
        expect(screen.queryByText("Nothing imported yet")).toBeNull();
    });

    it("renders nothing but the refusal for a role that may not import", async () => {
        renderPage({ forbidden: true, items: [TEMPLATES_RUN] });
        expect(screen.queryByRole("table")).toBeNull();
        expect(screen.queryByRole("link", { name: "Templates" })).toBeNull();
        expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
    });
});

describe("settings → imports: the entry points", () => {
    it("sends each entry point somewhere different", async () => {
        renderPage({ hasAssistedMigration: false });
        // The stub resolves its loader asynchronously, so nothing is on screen
        // until the first entry is. Awaiting one of them is what makes the
        // synchronous lookups below read the rendered page rather than an
        // empty body — a lesson four of these assertions learned out loud.
        await screen.findByRole("link", { name: "Templates" });

        const hrefs = ["Templates", "Contacts", "Team members"].map((name) =>
            screen.getByRole("link", { name }).getAttribute("href"),
        );

        expect(hrefs).toEqual([
            "/settings/imports?intent=templates.create",
            "/settings/imports?intent=contacts.import",
            "/settings/imports?intent=members.invite",
        ]);
        // Three links that all lead to the same place would satisfy the list
        // above only by accident; say it as a set so it cannot.
        expect(new Set(hrefs).size).toBe(3);
    });

    it("offers the unidentified-export entry only where a person can convert the file", async () => {
        renderPage({ hasAssistedMigration: true });
        await screen.findByRole("link", { name: "Templates" });
        expect(
            screen.getByRole("link", { name: /not sure what it is/i }).getAttribute("href"),
        ).toBe("/settings/imports?intent=assisted.full");
    });

    it("hides it where there is no support path", async () => {
        renderPage({ hasAssistedMigration: false });
        await screen.findByRole("link", { name: "Templates" });
        expect(screen.queryByRole("link", { name: /not sure what it is/i })).toBeNull();
    });

    it("hides it, rather than crashing, when the session carries no deployment block", async () => {
        // Fail closed. `ctx?.deployment.x` guards the context and not the block,
        // which throws on every session payload written before the capability
        // shipped.
        renderPage({ noDeploymentBlock: true });
        await screen.findByRole("link", { name: "Templates" });
        expect(screen.getByRole("link", { name: "Contacts" })).toBeTruthy();
        expect(screen.queryByRole("link", { name: /not sure what it is/i })).toBeNull();
    });
});

describe("settings → imports: starting a run", () => {
    it("opens no upload form until an entry point has been chosen", async () => {
        renderPage({});
        await screen.findByRole("link", { name: "Contacts" });
        expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    });

    it("opens the form for the entry point that was chosen, and says which", async () => {
        renderPage({ entry: "/settings/imports?intent=contacts.import" });
        expect(await screen.findByRole("button", { name: "Upload" })).toBeTruthy();
        expect(screen.getByTestId("import-start-intent").textContent).toBe("Contacts");
    });

    it("names the first thing to fix, and changes what it names as each is met", async () => {
        renderPage({ entry: "/settings/imports?intent=contacts.import" });

        const submit = await screen.findByRole("button", { name: "Upload" });
        expect(screen.getByTestId("import-start-blocked").textContent)
            .toBe("Choose the file you exported.");
        expect((submit as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(screen.getByTestId("import-start-file"), {
            target: { files: [new File(["a,b\n1,2"], "contacts.csv", { type: "text/csv" })] },
        });

        // The file is chosen, so the sentence must move on rather than clear:
        // the run still cannot start, and the reason is now the agreement.
        expect(screen.getByTestId("import-start-blocked").textContent)
            .toBe("Agree to us keeping the file, so this import can be picked up again later.");
        expect((submit as HTMLButtonElement).disabled).toBe(true);

        fireEvent.click(screen.getByTestId("import-start-authorize"));
        expect(screen.queryByTestId("import-start-blocked")).toBeNull();
        expect((submit as HTMLButtonElement).disabled).toBe(false);
    });

    it("asks the unidentified-export entry for the second agreement as well", async () => {
        // The support team would be reading a third party's contact details, so
        // that agreement is asked for separately and at the moment it applies —
        // which for this entry point is every time, because nothing here will
        // read the file.
        renderPage({ hasAssistedMigration: true, entry: "/settings/imports?intent=assisted.full" });

        fireEvent.change(await screen.findByTestId("import-start-file"), {
            target: { files: [new File(["x"], "unknown.xlsx")] },
        });
        fireEvent.click(screen.getByTestId("import-start-authorize"));

        expect(screen.getByTestId("import-start-blocked").textContent)
            .toBe("Agree to someone on the support team opening the file, because nothing here can read it.");

        fireEvent.click(screen.getByTestId("import-start-staff-authorize"));
        expect(screen.queryByTestId("import-start-blocked")).toBeNull();
    });

    it("does not ask for the second agreement on an entry point that names its own data", async () => {
        // The positive control for the case above: the staff agreement is not a
        // checkbox this form always shows.
        renderPage({ hasAssistedMigration: true, entry: "/settings/imports?intent=contacts.import" });
        await screen.findByTestId("import-start-file");
        expect(screen.queryByTestId("import-start-staff-authorize")).toBeNull();
    });
});
