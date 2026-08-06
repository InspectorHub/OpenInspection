// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ServicesCatalogPanel } from "./ServicesCatalogPanel";

/**
 * The catalog table used to hard-code an em dash in its DURATION column, because
 * no form could set a duration — so the column was decoration. It also said
 * nothing about the template, even though a service with no template makes any
 * booking that selects it fail with "Service 'X' has no template configured",
 * which the CUSTOMER sees and the admin has no way to anticipate.
 */
function renderPanel(
    services: Parameters<typeof ServicesCatalogPanel>[0]["services"],
    opts: {
        onEdit?: (id: string | null) => void;
        editingId?: string | null;
        members?: Parameters<typeof ServicesCatalogPanel>[0]["members"];
        payRuleMap?: Parameters<typeof ServicesCatalogPanel>[0]["payRuleMap"];
    } = {},
) {
    // The panel renders <Form> for the activate/deactivate action, so it needs a
    // router context.
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <ServicesCatalogPanel
                    services={services}
                    restrictionMap={{}}
                    members={opts.members ?? []}
                    templateNames={{ "tpl-1": "Residential Standard" }}
                    editingId={opts.editingId ?? null}
                    onEdit={opts.onEdit}
                    payRuleMap={opts.payRuleMap ?? {}}
                />
            ),
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

const base = {
    id: "svc-1",
    name: "Roof inspection",
    description: null,
    price: 35000,
    active: true,
    durationMinutes: null as number | null,
    templateId: null as string | null,
};

describe("ServicesCatalogPanel", () => {
    it("renders a stored duration in hours and minutes", () => {
        renderPanel([{ ...base, durationMinutes: 90, templateId: "tpl-1" }]);
        // Compact: the column is narrow enough that "1 hr 30 min" wrapped onto
        // two lines while the cell beside it had room to spare.
        expect(screen.getByText("1h 30m")).toBeTruthy();
    });

    it("renders whole hours and bare minutes without a zero component", () => {
        renderPanel([
            { ...base, id: "a", name: "A", durationMinutes: 120, templateId: "tpl-1" },
            { ...base, id: "b", name: "B", durationMinutes: 45, templateId: "tpl-1" },
        ]);
        expect(screen.getByText("2h")).toBeTruthy();
        expect(screen.getByText("45m")).toBeTruthy();
    });

    it("says a duration is not set rather than showing a bare dash", () => {
        renderPanel([{ ...base, templateId: "tpl-1" }]);
        // Scoped to the DURATION cell: the row says "Not set" twice since #278
        // added the pay-rule summary, and a bare getByText now matches both.
        expect(screen.getByRole("cell", { name: "Not set" })).toBeTruthy();
    });

    it("names the template a service builds from", () => {
        renderPanel([{ ...base, templateId: "tpl-1" }]);
        expect(screen.getByText(/Residential Standard/)).toBeTruthy();
    });

    it("warns that a service with no template breaks online booking", () => {
        renderPanel([{ ...base, templateId: null }]);
        expect(screen.getByText(/online booking fails/i)).toBeTruthy();
    });
});

/**
 * The row said a service was misconfigured and offered no way to fix it. Its only
 * "Edit" opened the qualified-inspector checkboxes — so name, price, duration and
 * template were writable exactly once, at creation, and the red "no template"
 * warning named a fault whose remedy was to deactivate the service and rebuild it.
 */
describe("ServicesCatalogPanel — a row's actions", () => {
    const MEMBERS = [{ id: "u1", email: "dana@example.com", role: "inspector", createdAt: "" }];

    it("offers editing the service itself, in the actions column", () => {
        const onEdit = vi.fn();
        renderPanel([{ ...base, templateId: null }], { onEdit });
        fireEvent.click(screen.getByRole("button", { name: "Edit" }));
        expect(onEdit).toHaveBeenCalledWith("svc-1");
    });

    it("turns that action into the way back out while the row is open", () => {
        const onEdit = vi.fn();
        renderPanel([{ ...base, templateId: null }], { onEdit, editingId: "svc-1" });
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
        expect(onEdit).toHaveBeenCalledWith(null);
    });

    it("no longer has a second control called Edit that edits something else", () => {
        renderPanel([{ ...base, templateId: "tpl-1" }], { onEdit: () => {}, members: MEMBERS });
        expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
        expect(screen.getByRole("button", { name: /change inspectors/i })).toBeTruthy();
    });

    it("keeps deactivation available beside it", () => {
        renderPanel([{ ...base, templateId: "tpl-1" }], { onEdit: () => {} });
        expect(screen.getByRole("button", { name: /deactivate/i })).toBeTruthy();
    });
});

/**
 * `payRuleMap` (#278) arrived as a REQUIRED prop with nothing in this file
 * passing it, and the panel indexes it unguarded — so every test here threw
 * during render. It went in green because co-located `app/**` tests are
 * excluded from the app tsc program (see the comment on `exclude` in
 * tsconfig.json), so nothing type-checks this call site: only actually running
 * `test:web` can see it.
 *
 * Passing `{}` to make the crash stop would assert nothing about the prop, so
 * this pins the difference a reader sees instead — which is also what makes the
 * fix above load-bearing rather than padding.
 */
describe("ServicesCatalogPanel — the pay-rule summary on a row", () => {
    const MEMBERS = [{ id: "u1", email: "dana@example.com", role: "inspector", createdAt: "" }];

    /**
     * Read through the "Pay:" label rather than by text: the DURATION cell of
     * the same row also says "Not set", and `getByText` matches an element's
     * direct text nodes — so the summary span (`<span>Pay:</span> Not set`)
     * and the duration cell are both hits for the bare string.
     */
    const paySummary = () => screen.getByText("Pay:").parentElement?.textContent;

    it("says a service has no pay rule when the map has no entry for it", () => {
        renderPanel([{ ...base, templateId: "tpl-1" }], { members: MEMBERS });
        expect(paySummary()).toBe("Pay: Not set");
    });

    it("counts the rules the map does carry for that service", () => {
        renderPanel([{ ...base, templateId: "tpl-1" }], {
            members: MEMBERS,
            payRuleMap: {
                "svc-1": [
                    { id: "pr-1", userId: "u1", type: "percent", percentBps: 6000, amountCents: null, deductionCents: null },
                ],
            },
        });
        expect(paySummary()).toBe("Pay: 1 pay rule");
    });
});
