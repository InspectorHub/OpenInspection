// @vitest-environment happy-dom
/**
 * #83 — editing an agreement must not silently revoke the cancellation-fee
 * attestation.
 *
 * THE MECHANISM, because the assertions below only make sense against it.
 * `updateAgreement` increments `agreements.version` on every save — it compares
 * nothing, so re-saving byte-identical text bumps it too — and
 * `BrandingService.getCancellationAttestation()` returns null the instant the
 * attested version stops matching the current one. `updateBranding` then refuses
 * any fee-charging cancellation policy. Until this editor shipped, NOTHING in
 * the product could bump that version, so a workspace could not lose
 * fee-charging by accident. Now one typo fix can.
 *
 * WHAT THIS PINS IS THAT THE AUTHOR IS TOLD, NOT THAT THE SAVE IS STOPPED. The
 * version bump is the feature: an agreement whose words changed genuinely has
 * not been re-confirmed, and skipping the bump would make the attestation
 * meaningless. So the control informs and gets out of the way — it names what
 * is lost and where to get it back, and the save still goes through.
 *
 * THE PAIRING IS THE POINT. A warning on every agreement edit is a warning
 * nobody reads, so the negative control (editing a template the attestation
 * does not name) is asserted as hard as the positive one.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { AgreementTemplateModal } from "./AgreementTemplateModal";
import { AGREEMENT_TEMPLATES_ACTION } from "~/routes/resources/agreement-templates";

const TEMPLATE = { id: "a1", name: "Residential", content: "<p>Cancel 24h ahead or pay 50%.</p>" };

function renderEditor(clauseAttested: boolean) {
    const saved: Record<string, string>[] = [];
    const Stub = createRoutesStub([
        {
            path: "/library/agreements",
            HydrateFallback: () => <div />,
            Component: () => (
                <AgreementTemplateModal
                    open
                    templateId={TEMPLATE.id}
                    onClose={() => {}}
                    onSaved={() => {}}
                />
            ),
        },
        {
            path: AGREEMENT_TEMPLATES_ACTION,
            loader: async () => ({ ok: true, template: TEMPLATE, clauseAttested }),
            action: async ({ request }: { request: Request }) => {
                const form = await request.formData();
                saved.push(Object.fromEntries(form) as Record<string, string>);
                return { ok: true, intent: "update", id: TEMPLATE.id };
            },
        },
    ]);
    render(<Stub initialEntries={["/library/agreements"]} />);
    return { saved };
}

/** The Banner the warning rides on is `tone="warn"`, which is `role="alert"`. */
function alerts(): string[] {
    return screen.queryAllByRole("alert").map((el) => el.textContent ?? "");
}

describe("AgreementTemplateModal — cancellation-clause warning", () => {
    it("tells the author what saving costs, and where to get it back", async () => {
        renderEditor(true);
        await screen.findByDisplayValue("Residential");

        await waitFor(() => expect(alerts()).toHaveLength(1));
        const text = alerts()[0]!;
        // Three things a reader needs: that this is about cancellation fees,
        // that saving revokes the confirmation, and where to re-confirm.
        expect(text).toMatch(/cancellation fee/i);
        expect(text).toMatch(/confirm/i);
        expect(text).toMatch(/settings/i);
    });

    it("does not warn when the attestation names a DIFFERENT template", async () => {
        // The positive control. This is the state almost every edit is in, and
        // a banner shown here would train the author to ignore the one above.
        renderEditor(false);
        await screen.findByDisplayValue("Residential");
        await new Promise((r) => setTimeout(r, 0));
        expect(alerts()).toEqual([]);
    });

    it("informs, and then lets the save through", async () => {
        // NOT a block and NOT a second confirm click. The author is allowed to
        // change their own agreement; what they are owed is knowing the price.
        const { saved } = renderEditor(true);
        await screen.findByDisplayValue("Residential");
        await waitFor(() => expect(alerts()).toHaveLength(1));

        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        await waitFor(() => expect(saved).toHaveLength(1));
        expect(saved[0]).toMatchObject({ intent: "update", id: TEMPLATE.id, name: "Residential" });
    });
});
