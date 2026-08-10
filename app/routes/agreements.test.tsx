// @vitest-environment happy-dom
/**
 * #84 — Library → Agreements must say what a delete costs, and say when a write
 * has already cost it.
 *
 * Deleting the template the workspace confirmed its cancellation clause against
 * makes `BrandingService.getCancellationAttestation()` return null (the row is
 * gone), and `updateBranding` then refuses every fee-charging cancellation
 * policy. #83 gave the EDITOR a banner for the save path and left this one open:
 * the delete dialog asked "are you sure?" about a row, while what actually went
 * away was the ability to charge a cancellation fee.
 *
 * Two surfaces, two different jobs, and they must not be confused:
 *
 *   BEFORE — the confirm dialog names the cost, the way `ReportsCard` names what
 *   a report deletion destroys. It is driven by the loader's
 *   `attestedAgreementId`, which comes from the branding endpoint's
 *   server-computed `cancellationClause`, so it is scoped to ONE template.
 *
 *   AFTER — the notice is driven by `clauseRevoked` on the action result, which
 *   the server MEASURED around the write. It is the same signal an MCP client
 *   reads out of the response body, so the page and the tool cannot disagree.
 *   It fires for edits as well as deletes, which is why it is not folded into
 *   the dialog copy.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import AgreementsPage from "~/routes/agreements";
import { AGREEMENT_TEMPLATES_ACTION } from "~/routes/resources/agreement-templates";
import type { AgreementTemplateSaveResult } from "~/routes/resources/agreement-templates";

const TEMPLATES = [
    { id: "a1", name: "Residential", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "a2", name: "Commercial", createdAt: "2026-01-01T00:00:00.000Z" },
];

function renderPage(
    loaderData: Record<string, unknown>,
    actionResult: AgreementTemplateSaveResult = { ok: true, intent: "delete", id: "a1", clauseRevoked: false },
) {
    const Stub = createRoutesStub([
        { path: "/agreements", Component: AgreementsPage, loader: () => loaderData },
        { path: AGREEMENT_TEMPLATES_ACTION, action: () => actionResult },
    ]);
    return render(<Stub initialEntries={["/agreements"]} />);
}

const BASE = { templates: TEMPLATES, loadFailed: false, attestedAgreementId: null };

/**
 * Open the delete dialog for the row with this name, and return the dialog's
 * text. Scoped to the dialog on purpose: the template name also appears in its
 * table row, so a page-wide text query cannot tell "the dialog names it" from
 * "the table lists it".
 */
async function openDelete(screen: ReturnType<typeof render>, rowName: string): Promise<HTMLElement> {
    const row = (await screen.findByText(rowName)).closest("tr");
    if (!row) throw new Error(`no row for ${rowName}`);
    const remove = Array.from(row.querySelectorAll("button")).find((b) => /^delete$/i.test(b.textContent ?? ""));
    if (!remove) throw new Error(`no delete button in row ${rowName}`);
    fireEvent.click(remove);
    return await screen.findByRole("dialog");
}

/** Press the dialog's confirm button (not the per-row "Delete" beside it). */
function confirmDelete(dialog: HTMLElement) {
    const button = Array.from(dialog.querySelectorAll("button")).find((b) => /^delete$/i.test(b.textContent ?? ""));
    if (!button) throw new Error("no confirm button in dialog");
    fireEvent.click(button);
}

describe("agreements page — the delete dialog names what is lost", () => {
    it("says fee charging stops when the attested template is the one being deleted", async () => {
        const screen = renderPage({ ...BASE, attestedAgreementId: "a1" });
        const dialog = await openDelete(screen, "Residential");

        // Names the template AND the capability. "Are you sure?" about a row is
        // not a description of losing the ability to charge a cancellation fee.
        expect(dialog.textContent).toMatch(/Residential/);
        expect(dialog.textContent).toMatch(/cancellation fee/i);
        // And it says how to get it back, rather than leaving a dead end.
        expect(dialog.textContent).toMatch(/confirm/i);
    });

    it("stays quiet about fees when a DIFFERENT template is being deleted", async () => {
        // The positive control. A page-wide "this workspace charges fees" flag
        // would put the sentence on every delete and teach people to skip it.
        const screen = renderPage({ ...BASE, attestedAgreementId: "a1" });
        const dialog = await openDelete(screen, "Commercial");

        expect(dialog.textContent).toMatch(/Commercial/);
        expect(dialog.textContent).not.toMatch(/cancellation fee/i);
    });

    it("stays quiet about fees when nothing is attested at all", async () => {
        const screen = renderPage({ ...BASE, attestedAgreementId: null });
        const dialog = await openDelete(screen, "Residential");

        expect(dialog.textContent).not.toMatch(/cancellation fee/i);
    });
});

describe("agreements page — the notice after a write that revoked", () => {
    it("says fee charging is off once the server reports a revocation", async () => {
        const screen = renderPage(
            { ...BASE, attestedAgreementId: "a1" },
            { ok: true, intent: "delete", id: "a1", clauseRevoked: true },
        );
        confirmDelete(await openDelete(screen, "Residential"));

        expect(await screen.findByText(/cancellation fees are off/i)).toBeTruthy();
    });

    it("says nothing when the server reports no revocation", async () => {
        const screen = renderPage(
            { ...BASE, attestedAgreementId: null },
            { ok: true, intent: "delete", id: "a2", clauseRevoked: false },
        );
        confirmDelete(await openDelete(screen, "Commercial"));

        // Let the fetcher settle, so this is "the notice never appeared" and
        // not "the assertion ran before it could".
        await screen.findByText(/Commercial/);
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByText(/cancellation fees are off/i)).toBeNull();
    });
});
