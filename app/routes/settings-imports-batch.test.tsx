// @vitest-environment happy-dom
/**
 * `/settings/imports/:batchId` — one run, on its own address.
 *
 * A wizard is the easiest thing in this codebase to test vacuously. "The
 * mapping step renders" is true of nearly every run, "the Next button is
 * disabled" is true of the last step of every run, and both would stay green
 * against a shell that had no rules at all. So every assertion below either
 * COMPARES two runs differing in exactly one property, or names which step is
 * CURRENT rather than merely present, or reads the blocked SENTENCE and watches
 * it change as each condition is met.
 *
 * The three things this page decides, and where each is pinned:
 *
 *   1. which steps this run has — asserted as an ordered list against a run
 *      that differs by one property, in both directions;
 *   2. where the run OPENS — the landing step, which is not "the first step"
 *      and is not the same for a run with problems as for a clean one;
 *   3. which of the two screens a run gets — the wizard, or the waiting
 *      screen, which is itself two different screens depending on whether this
 *      deployment has anybody to hand the file to.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import SettingsImportsBatch from "~/routes/settings-imports-batch";

interface ProblemFixture {
    rowId: string;
    entity: string;
    position: number;
    field?: string;
    reason: string;
    value?: string;
    suggestion?: string;
    payloadEcho: Record<string, unknown>;
}

interface ReportFixture {
    batch: { id: string; intent: string; vendor: string; status: string; createdAt: string };
    counts: { total: number; ok: number; conflicts: number; problems: number };
    problemRows: ProblemFixture[];
    problemRowsTotal: number;
    page: number;
    pageSize: number;
    blockedReason: string | null;
    inspection: unknown;
    mapping: unknown;
    undoUntil: string | null;
}

/** A run that can be mapped, has nothing wrong with it, and is ready to apply. */
function report(over: Partial<ReportFixture> = {}): ReportFixture {
    return {
        batch: {
            id: "batch-1",
            intent: "contacts.import",
            vendor: "csv_generic",
            status: "staged",
            createdAt: "2026-08-14T10:00:00.000Z",
        },
        counts: { total: 4, ok: 4, conflicts: 0, problems: 0 },
        problemRows: [],
        problemRowsTotal: 0,
        page: 1,
        pageSize: 25,
        blockedReason: null,
        inspection: { columns: ["Full Name", "Email"], sampleRows: [] },
        // `type` is part of what the server actually sends: a contact's type is
        // never in the file, so the guess answers it with one value for
        // everybody and the step asks whether that is right.
        mapping: { kind: "contacts", mapping: { name: "Full Name", type: { fixed: "client" } } },
        undoUntil: "2026-09-13",
        ...over,
    };
}

/** One entry the server says cannot be written as it stands. */
function problem(over: Partial<ProblemFixture> = {}): ProblemFixture {
    return {
        rowId: "row-1",
        entity: "contact",
        position: 0,
        field: "name",
        reason: "This entry has no name.",
        payloadEcho: { name: "", email: "a@example.test", type: "client" },
        ...over,
    };
}

function renderPage(opts: {
    report?: ReportFixture | null;
    forbidden?: boolean;
    hasAssistedMigration?: boolean;
    /** Omit the deployment block entirely — an older cached session payload. */
    noDeploymentBlock?: boolean;
    /** Answers the report for the page the address asks for, so paging is real. */
    reportForPage?: (page: number) => ReportFixture;
    /** Records what each write actually posted. */
    onAction?: (form: FormData) => void;
} = {}) {
    // The viewer sits WEST of Greenwich on purpose. `undoUntil` is a civil day,
    // and a zone of UTC would let a page that read it as an instant pass the
    // retention assertion below by coincidence.
    const context = opts.noDeploymentBlock
        ? { branding: { defaultLocale: "en-US", defaultTimezone: "America/Los_Angeles" }, user: {} }
        : {
            branding: { defaultLocale: "en-US", defaultTimezone: "America/Los_Angeles" },
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
                    path: "settings/imports/:batchId",
                    Component: SettingsImportsBatch,
                    loader: ({ request }) => {
                        if (opts.reportForPage) {
                            const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
                            return { forbidden: false, report: opts.reportForPage(page) };
                        }
                        return {
                            forbidden: opts.forbidden ?? false,
                            report: opts.report === undefined ? report() : opts.report,
                        };
                    },
                    action: async ({ request }) => {
                        opts.onAction?.(await request.formData());
                        return { error: null };
                    },
                },
            ],
        },
    ]);
    return render(<Stub initialEntries={["/settings/imports/batch-1"]} />);
}

/** The steps this run has, in the order the rail prints them. */
async function railSteps(): Promise<string[]> {
    const rail = await screen.findByRole("list", { name: "Import steps" });
    return within(rail).getAllByRole("button").map((b) => b.textContent);
}

/** The step the rail marks as the one being looked at. */
function currentStep(): string {
    const rail = screen.getByRole("list", { name: "Import steps" });
    const marked = within(rail).getAllByRole("button")
        .filter((b) => b.getAttribute("aria-current") === "step");
    // Two marked steps and none are the same failure — a rail that marks
    // everything says as little as one that marks nothing.
    expect(marked).toHaveLength(1);
    return marked[0].textContent;
}

describe("an import run: which steps it has", () => {
    it("drops the mapping step for a run whose report carries no columns", async () => {
        renderPage({ report: report({ inspection: null, mapping: null }) });
        expect(await railSteps()).toEqual(["1Upload", "2Import"]);
    });

    it("keeps it for a run that differs in exactly that, and renumbers", async () => {
        // The positive control for the case above, and the reason the numbers
        // are read back rather than the labels alone: the step's number is its
        // position IN THIS RUN, so dropping a step has to move the ones after
        // it. A rail printing the fixed 1..4 passes a labels-only assertion.
        renderPage({ report: report() });
        expect(await railSteps()).toEqual(["1Upload", "2Columns", "3Import"]);
    });

    it("adds the fix step for a run that differs only by having problems", async () => {
        renderPage({ report: report({ counts: { total: 4, ok: 2, conflicts: 0, problems: 2 } }) });
        expect(await railSteps()).toEqual(["1Upload", "2Columns", "3Fix", "4Import"]);
    });
});

describe("an import run: where it opens", () => {
    it("opens on the step that still wants something, not on the first one", async () => {
        renderPage({ report: report({ counts: { total: 4, ok: 2, conflicts: 0, problems: 2 } }) });
        await railSteps();
        expect(currentStep()).toBe("3Fix");
    });

    it("opens on Import for a run that differs only by having nothing wrong", async () => {
        // The positive control: a page that always landed on the last step, or
        // always on the first, satisfies exactly one of these two.
        renderPage({ report: report() });
        await railSteps();
        expect(currentStep()).toBe("3Import");
    });

    it("moves to the step that was clicked, and only that one is current", async () => {
        renderPage({ report: report() });
        await railSteps();
        fireEvent.click(screen.getByTestId("import-step-upload"));
        expect(currentStep()).toBe("1Upload");
    });
});

describe("an import run: why moving on is unavailable", () => {
    it("names the entries that still cannot be imported, counting them", async () => {
        renderPage({ report: report({ counts: { total: 4, ok: 1, conflicts: 0, problems: 3 } }) });
        // Count-last on purpose: the catalogue has no plural variants, and
        // "1 entries still cannot be imported" is what a count-first sentence
        // renders for the commonest case.
        expect((await screen.findByTestId("import-step-blocked")).textContent)
            .toBe("Entries that still cannot be imported: 3.");
        expect((screen.getByTestId("import-step-next") as HTMLButtonElement).disabled).toBe(true);
    });

    it("stops saying it once the entries are fixed, and lets the run move on", async () => {
        // The half that matters: a sentence that is always printed is not a
        // reason, and a Next button that is always disabled is not a rule.
        renderPage({ report: report({ counts: { total: 4, ok: 4, conflicts: 0, problems: 0 } }) });
        await railSteps();
        fireEvent.click(screen.getByTestId("import-step-mapping"));
        expect(screen.queryByTestId("import-step-blocked")).toBeNull();
        expect((screen.getByTestId("import-step-next") as HTMLButtonElement).disabled).toBe(false);
    });

    it("prints the server's own sentence on the import step rather than one of its own", async () => {
        // Word for word: the server counts the seats, and a second answer
        // worked out here is how a banner and a button come to disagree.
        renderPage({
            report: report({
                blockedReason: "This import needs 3 seats and 1 are available. Upgrade your plan, or import fewer people.",
            }),
        });
        expect((await screen.findByTestId("import-step-blocked")).textContent)
            .toBe("This import needs 3 seats and 1 are available. Upgrade your plan, or import fewer people.");
    });
});

describe("an import run: what it was read from", () => {
    it("says where the file came from, when it started and when it stops being kept", async () => {
        renderPage({ report: report() });
        await railSteps();
        fireEvent.click(screen.getByTestId("import-step-upload"));

        expect(screen.getByText("csv_generic")).toBeTruthy();
        expect(screen.getByText("Aug 14, 2026")).toBeTruthy();
        // The retention day is a civil day, not an instant. Read in the
        // viewer's zone it would land on the 12th for anybody west of
        // Greenwich, which is a date this run was never kept until.
        expect(screen.getByText("Sep 13, 2026")).toBeTruthy();
    });

    it("says so, rather than leaving a blank, for a run kept by another rule", async () => {
        renderPage({ report: report({ undoUntil: null }) });
        await railSteps();
        fireEvent.click(screen.getByTestId("import-step-upload"));
        expect(screen.queryByText("Sep 13, 2026")).toBeNull();
        expect(screen.getByText("—")).toBeTruthy();
    });

    it("shows it only on the Upload step", async () => {
        // The positive control for the three above: a panel mounted on every
        // step passes all of them and tells nobody which step they are on.
        renderPage({ report: report() });
        await railSteps();
        expect(screen.queryByText("Where this import came from")).toBeNull();
    });
});

describe("an import run whose file nothing could read", () => {
    it("shows the waiting screen instead of the wizard, and no step rail with it", async () => {
        renderPage({
            hasAssistedMigration: true,
            report: report({
                batch: { id: "b", intent: "assisted.full", vendor: "csv_generic", status: "needs_assistance", createdAt: "2026-08-14T10:00:00.000Z" },
                counts: { total: 0, ok: 0, conflicts: 0, problems: 0 },
                inspection: null,
                mapping: null,
            }),
        });
        expect(await screen.findByText(/We have your file and will convert it/)).toBeTruthy();
        expect(screen.queryByRole("list", { name: "Import steps" })).toBeNull();
        // And no offer to send it: the agreement was taken with the file, so a
        // control asking for it again would post to a route that does not exist.
        expect(screen.queryByRole("button", { name: "Send it to us" })).toBeNull();
    });

    it("shows what this import CAN read where there is nobody to hand it to", async () => {
        // The two screens differ by their whole content, not by a disabled
        // button: with no support path there was never an offer to make.
        renderPage({
            hasAssistedMigration: false,
            report: report({
                batch: { id: "b", intent: "assisted.full", vendor: "csv_generic", status: "needs_assistance", createdAt: "2026-08-14T10:00:00.000Z" },
                counts: { total: 0, ok: 0, conflicts: 0, problems: 0 },
            }),
        });
        expect(await screen.findByText(/This import accepts a Spectora template export/)).toBeTruthy();
        expect(screen.queryByText(/We have your file and will convert it/)).toBeNull();
    });

    it("falls closed, rather than crashing, when the session carries no deployment block", async () => {
        // `ctx?.deployment.x` guards the context and not the block, which throws
        // on every session payload written before the capability shipped.
        renderPage({
            noDeploymentBlock: true,
            report: report({
                batch: { id: "b", intent: "assisted.full", vendor: "csv_generic", status: "needs_assistance", createdAt: "2026-08-14T10:00:00.000Z" },
                counts: { total: 0, ok: 0, conflicts: 0, problems: 0 },
            }),
        });
        expect(await screen.findByText(/This import accepts a Spectora template export/)).toBeTruthy();
    });

    it("prints no counts for a run that has read no file, rather than four zeroes", async () => {
        renderPage({
            hasAssistedMigration: true,
            report: report({
                batch: { id: "b", intent: "assisted.full", vendor: "csv_generic", status: "needs_assistance", createdAt: "2026-08-14T10:00:00.000Z" },
                counts: { total: 0, ok: 0, conflicts: 0, problems: 0 },
            }),
        });
        await screen.findByText(/We have your file and will convert it/);
        expect(screen.queryByTestId("import-counts")).toBeNull();
    });

    it("prints them for a run that has, which is the control on the line above", async () => {
        renderPage({ report: report() });
        expect((await screen.findByTestId("import-counts")).textContent)
            .toBe("4 entries · 4 ready · 0 already exist · 0 need fixing");
    });
});

describe("an import run: the three stages sit on their own steps", () => {
    it("shows the mapping form only on the mapping step", async () => {
        renderPage({ report: report() });
        await railSteps();
        // The run opens on Import, so the form is not on screen yet — a stage
        // mounted on every step passes any "it renders" assertion and tells
        // nobody which step they are on.
        expect(screen.queryByLabelText("Name")).toBeNull();
        fireEvent.click(screen.getByTestId("import-step-mapping"));
        expect(screen.getByLabelText("Name")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    });

    it("posts the columns the operator chose, not the ones the report arrived with", async () => {
        const posted: FormData[] = [];
        renderPage({ report: report(), onAction: (f) => posted.push(f) });
        await railSteps();
        fireEvent.click(screen.getByTestId("import-step-mapping"));
        fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Email" } });
        fireEvent.click(screen.getByRole("button", { name: "Use these columns" }));
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0].get("op")).toBe("mapping");
        expect(JSON.parse(String(posted[0].get("mapping")))).toEqual({
            kind: "contacts",
            mapping: { name: "Full Name", email: "Email", type: { fixed: "client" } },
        });
    });

    it("drops the mapping step for a template run, whose mapping has no columns in it", async () => {
        // A template mapping carries a NAME rather than a column choice. It
        // cannot arrive with an inspection today; a step that rendered for it
        // would show a form with nothing on it.
        renderPage({
            report: report({
                batch: { id: "b", intent: "templates.create", vendor: "spectora", status: "staged", createdAt: "2026-08-14T10:00:00.000Z" },
                mapping: { kind: "template", name: "Roof" },
            }),
        });
        expect(await railSteps()).toEqual(["1Upload", "2Import"]);
    });

    it("posts one entry's whole payload from the fix step, with the edited field replaced", async () => {
        const posted: FormData[] = [];
        renderPage({
            report: report({
                counts: { total: 4, ok: 3, conflicts: 0, problems: 1 },
                problemRows: [problem()],
                problemRowsTotal: 1,
            }),
            onAction: (f) => posted.push(f),
        });
        await railSteps();
        fireEvent.change(screen.getByLabelText("Contact 1 name"), { target: { value: "Alice Ng" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0].get("op")).toBe("repair");
        expect(posted[0].get("rowId")).toBe("row-1");
        expect(JSON.parse(String(posted[0].get("payload")))).toEqual({
            name: "Alice Ng", email: "a@example.test", type: "client",
        });
    });

    it("asks the server for the page that was clicked, and renders what comes back", async () => {
        // Paging is the server's: the report carries one page of entries and the
        // count behind it. A page control the screen answered itself would be
        // paging a list it holds only the first slice of.
        renderPage({
            reportForPage: (page) => report({
                counts: { total: 60, ok: 30, conflicts: 0, problems: 30 },
                problemRows: [problem({ rowId: `row-${page}`, position: (page - 1) * 25 })],
                problemRowsTotal: 30,
                page,
            }),
        });
        await railSteps();
        expect(screen.getByText("Contact 1")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
        expect(await screen.findByText("Contact 26")).toBeTruthy();
        expect(screen.queryByText("Contact 1")).toBeNull();
    });

    it("posts the clash policy the operator chose from the import step", async () => {
        const posted: FormData[] = [];
        renderPage({
            report: report({ counts: { total: 4, ok: 1, conflicts: 3, problems: 0 } }),
            onAction: (f) => posted.push(f),
        });
        await railSteps();
        fireEvent.click(screen.getByRole("radio", { name: "Replace with the imported version" }));
        fireEvent.click(screen.getByRole("button", { name: "Import" }));
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0].get("op")).toBe("apply");
        expect(posted[0].get("conflictPolicy")).toBe("overwrite");
    });
});

describe("an import run: taking it back", () => {
    it("asks before undoing, and posts nothing until the dialog is answered", async () => {
        // An undo deletes real rows, and this repository does not use
        // `window.confirm` — so the confirmation is a rendered dialog, and its
        // presence is what the assertion reads.
        const posted: FormData[] = [];
        renderPage({
            report: report({ batch: { id: "b", intent: "contacts.import", vendor: "csv_generic", status: "applied", createdAt: "2026-08-14T10:00:00.000Z" } }),
            onAction: (f) => posted.push(f),
        });
        await railSteps();
        // The date is the run's civil retention day, formatted once by the page.
        expect(screen.getByText("Available until Sep 13, 2026.")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
        expect(posted).toHaveLength(0);
        expect(screen.getByText("Undo this import?")).toBeTruthy();
    });

    it("posts the undo once the dialog is confirmed", async () => {
        const posted: FormData[] = [];
        renderPage({
            report: report({ batch: { id: "b", intent: "contacts.import", vendor: "csv_generic", status: "applied", createdAt: "2026-08-14T10:00:00.000Z" } }),
            onAction: (f) => posted.push(f),
        });
        await railSteps();
        fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Undo this import" }));
        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0].get("op")).toBe("revert");
    });
});

describe("an import run that cannot be shown", () => {
    it("renders nothing but the refusal for a role that may not import", async () => {
        renderPage({ forbidden: true });
        expect(await screen.findByText("Admins only")).toBeTruthy();
        expect(screen.queryByRole("list", { name: "Import steps" })).toBeNull();
    });

    it("says the run is gone, and still leaves a way back to the list", async () => {
        renderPage({ report: null });
        expect(await screen.findByText(/This import could not be found/)).toBeTruthy();
        expect(screen.getByRole("link", { name: "Past imports" }).getAttribute("href"))
            .toBe("/settings/imports");
    });
});
