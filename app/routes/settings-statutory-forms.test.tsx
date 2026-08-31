// @vitest-environment happy-dom
/**
 * `/settings/statutory-forms` — the screen that supplies an authority's own PDF.
 *
 * ── THE ASSERTION THIS FILE EXISTS FOR ──────────────────────────────────────
 * The server's refusal names the uploaded file's sha256, the one the revision
 * records, the fact that the revision is printed inside the document, and where
 * the authority publishes it. That paragraph IS the remedy, and a screen that
 * replaced it with "Upload failed" would still pass a test asserting "an error
 * is shown" — which is exactly the wrong-satisfier this page was built to
 * avoid. So the refusal is asserted VERBATIM, as one text node, and the
 * generic sentence is asserted ABSENT in the same breath.
 *
 * The other three are pairs for the same reason:
 *   - presence is read per row, and each row is checked NOT to wear the
 *     other's pill (a page that rendered one row twice passes any single-row
 *     assertion);
 *   - the result banner is checked to land on the row it belongs to AND to be
 *     absent from the other (one shared banner satisfies the first alone);
 *   - the "no storage bound" warning has a positive control and a negative
 *     one, because a banner that is always mounted looks identical to a
 *     correct one on the only screenshot anybody takes.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import SettingsStatutoryForms from "~/routes/settings-statutory-forms";
import type { StatutorySourceRowData } from "~/components/statutory/StatutorySourceRow";

/**
 * A real refusal, in the server's own words. Copied from
 * `sourceHashMismatchMessage` rather than imported: the point of the assertion
 * is that whatever the server wrote arrives unchanged, and a test that built
 * the string from the same function the page never calls would prove only that
 * two copies of one helper agree.
 */
const REFUSAL =
    "This file's sha256 is 1111111111111111111111111111111111111111111111111111111111111111, "
    + "and revision 7-6 of tx_trec_rei records "
    + "2222222222222222222222222222222222222222222222222222222222222222. They are two "
    + "different documents. The revision printed on the document itself is what tells "
    + "them apart -- the filename does not, and neither does the address it was "
    + "downloaded from: an authority may serve a superseded revision at its most "
    + "obvious URL. Open the PDF, confirm the page prints revision 7-6, and upload that "
    + "file. This revision is published at https://www.trec.texas.gov/forms/rei-7-6.";

/** What the page falls back to when the server wrote nothing of its own. */
const GENERIC = "The upload was refused and nothing was stored.";

const STORED: StatutorySourceRowData = {
    formId: "tx_trec_rei",
    revision: "7-6",
    sourceHash: "2222222222222222222222222222222222222222222222222222222222222222",
    sourceUrl: "https://www.trec.texas.gov/forms/rei-7-6",
    effectiveFrom: Date.UTC(2025, 1, 1),
    mandatoryFrom: Date.UTC(2025, 3, 1),
    effectiveUntil: null,
    withdrawn: null,
    present: true,
    sizeBytes: 620865,
    uploadedAt: Date.UTC(2026, 7, 29),
};

const MISSING: StatutorySourceRowData = {
    formId: "yy_flat_form",
    revision: "Rev. 04/26",
    sourceHash: "3333333333333333333333333333333333333333333333333333333333333333",
    sourceUrl: "https://example.gov/forms/flat.pdf",
    effectiveFrom: Date.UTC(2026, 0, 1),
    mandatoryFrom: null,
    effectiveUntil: null,
    withdrawn: null,
    present: false,
    sizeBytes: null,
    uploadedAt: null,
};

type ActionResult = {
    ok: boolean;
    formId: string;
    revision: string;
    serverError: string | null;
};

function renderPage(opts: {
    revisions?: StatutorySourceRowData[];
    forbidden?: boolean;
    loadFailed?: boolean;
    storageBound?: boolean;
    /** What the stub action answers, given what the submitted form carried. */
    answer?: (formId: string, revision: string) => ActionResult;
} = {}) {
    const context = {
        branding: { defaultLocale: "en-US", defaultTimezone: "UTC" },
        user: { role: "owner" },
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
                    path: "settings/statutory-forms",
                    Component: SettingsStatutoryForms,
                    loader: () => ({
                        forbidden: opts.forbidden ?? false,
                        loadFailed: opts.loadFailed ?? false,
                        storageBound: opts.storageBound ?? true,
                        revisions: opts.revisions ?? [],
                    }),
                    action: async ({ request }: { request: Request }) => {
                        const form = await request.formData();
                        return opts.answer?.(
                            String(form.get("formId")),
                            String(form.get("revision")),
                        ) ?? { ok: true, formId: "", revision: "", serverError: null };
                    },
                },
            ],
        },
    ]);
    return render(<Stub initialEntries={["/settings/statutory-forms"]} />);
}

/** One revision's card, found by the id the row stamps on itself. */
async function card(row: StatutorySourceRowData): Promise<HTMLElement> {
    return await screen.findByTestId(`statutory-source-${row.formId}-${row.revision}`);
}

/** Press Upload inside one row and wait for the action's answer to land. */
async function upload(row: StatutorySourceRowData): Promise<void> {
    const button = within(await card(row)).getByRole("button", { name: "Upload" });
    button.click();
    await screen.findByRole("alert");
}

describe("settings → statutory form PDFs: what the server said", () => {
    it("prints the server's refusal verbatim, and does not fall back to its own sentence", async () => {
        renderPage({
            revisions: [STORED],
            answer: (formId, revision) => ({ ok: false, formId, revision, serverError: REFUSAL }),
        });

        await upload(STORED);

        // As ONE text node. A page that showed a summary, a truncation, or its
        // own wording with the server's appended would not match this.
        expect(screen.getByText(REFUSAL)).toBeTruthy();
        // The wrong satisfier, named and excluded: a generic banner would pass
        // any "an error is shown" assertion.
        expect(screen.queryByText(GENERIC)).toBeNull();
        // And the two facts only the server can supply — the hash it computed
        // for the file that was sent, and the hash the revision records. A
        // relay that dropped either would leave the operator unable to tell
        // which of several identical-looking PDFs they are holding.
        expect(screen.getByText(REFUSAL).textContent).toContain(
            "1111111111111111111111111111111111111111111111111111111111111111",
        );
        expect(screen.getByText(REFUSAL).textContent).toContain(
            "2222222222222222222222222222222222222222222222222222222222222222",
        );
    });

    it("uses its own localised sentence only when the server wrote none", async () => {
        // The positive control for the fallback. Without it, a page that ALWAYS
        // showed the generic line would satisfy nothing above and still look
        // tested from this file's title.
        renderPage({
            revisions: [STORED],
            answer: (formId, revision) => ({ ok: false, formId, revision, serverError: null }),
        });

        await upload(STORED);

        expect(screen.getByText(GENERIC)).toBeTruthy();
        expect(screen.queryByText(REFUSAL)).toBeNull();
    });

    it("shows a refusal on the row it belongs to and on no other", async () => {
        renderPage({
            revisions: [STORED, MISSING],
            answer: (formId, revision) => ({ ok: false, formId, revision, serverError: REFUSAL }),
        });

        await upload(MISSING);

        expect(within(await card(MISSING)).getByText(REFUSAL)).toBeTruthy();
        // The negative half. One page-level banner satisfies the line above
        // while telling a reader that the OTHER revision was refused.
        expect(within(await card(STORED)).queryByText(REFUSAL)).toBeNull();
    });

    it("says the file was stored, naming the revision, when the upload is accepted", async () => {
        renderPage({
            revisions: [STORED],
            answer: (formId, revision) => ({ ok: true, formId, revision, serverError: null }),
        });

        const button = within(await card(STORED)).getByRole("button", { name: "Upload" });
        button.click();

        expect(await screen.findByText("Stored. Revision 7-6 of tx_trec_rei can be produced now."))
            .toBeTruthy();
        expect(screen.queryByText(GENERIC)).toBeNull();
    });
});

describe("settings → statutory form PDFs: the list", () => {
    it("reads presence per revision, and neither row wears the other's answer", async () => {
        renderPage({ revisions: [STORED, MISSING] });

        const stored = within(await card(STORED));
        expect(stored.getByText("Stored")).toBeTruthy();
        expect(stored.getByText("606 KB, uploaded Aug 29, 2026")).toBeTruthy();

        const missing = within(await card(MISSING));
        expect(missing.getByText("Not stored")).toBeTruthy();
        expect(
            missing.getByText(/installs but produces nothing/),
        ).toBeTruthy();

        // A page that rendered one row twice, or derived presence once for the
        // whole list, passes both blocks above and fails here.
        expect(stored.queryByText("Not stored")).toBeNull();
        expect(missing.queryByText("Stored")).toBeNull();
    });

    it("carries the form id and the revision label in the request body, not the URL", async () => {
        // The revision label is the authority's own and may contain a slash;
        // the endpoint takes it as a form field for exactly that reason. If it
        // ever moved into the path this assertion goes red, which is the point.
        renderPage({ revisions: [MISSING] });

        const form = (await card(MISSING)).querySelector("form");
        expect(form?.getAttribute("enctype")).toBe("multipart/form-data");
        expect(form?.querySelector<HTMLInputElement>('input[name="formId"]')?.value)
            .toBe("yy_flat_form");
        expect(form?.querySelector<HTMLInputElement>('input[name="revision"]')?.value)
            .toBe("Rev. 04/26");
        expect(form?.querySelector<HTMLInputElement>('input[name="file"]')?.type).toBe("file");
    });

    it("shows the expected sha256 in full, because a truncated one cannot be compared", async () => {
        renderPage({ revisions: [MISSING] });
        expect(within(await card(MISSING)).getByText(MISSING.sourceHash)).toBeTruthy();
    });

    it("warns that nothing can be stored when no bucket is bound", async () => {
        renderPage({ revisions: [MISSING], storageBound: false });
        expect(await screen.findByText(/no object storage bound/)).toBeTruthy();
    });

    it("stays quiet about storage when a bucket IS bound", async () => {
        // The negative control for the test above. An always-mounted banner is
        // indistinguishable from a correct one until somebody looks for its
        // absence — its own `it` rather than a second half, so a cleanup that
        // stopped running cannot make one render look like two.
        renderPage({ revisions: [MISSING], storageBound: true });
        await screen.findByTestId("statutory-source-yy_flat_form-Rev. 04/26");
        expect(screen.queryByText(/no object storage bound/)).toBeNull();
    });

    it("does not call the catalogue empty when the read failed", async () => {
        // "This build publishes no statutory forms" is a claim about the
        // SOFTWARE. Made on the strength of a failed request it is false, and
        // an operator would act on it by giving up.
        renderPage({ revisions: [], loadFailed: true });
        expect(await screen.findByText(/could not be read/)).toBeTruthy();
        expect(screen.queryByText("This build publishes no statutory forms")).toBeNull();
    });

    it("says the catalogue is empty when it really is", async () => {
        renderPage({ revisions: [], loadFailed: false });
        expect(await screen.findByText("This build publishes no statutory forms")).toBeTruthy();
    });

    it("renders nothing but the refusal for a member who is not the owner", async () => {
        renderPage({ revisions: [STORED], forbidden: true });
        expect(screen.queryByTestId("statutory-source-tx_trec_rei-7-6")).toBeNull();
    });
});
