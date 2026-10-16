// @vitest-environment happy-dom
/**
 * The two order-edit controls on the inspection page stand down for a viewer the
 * API refuses them.
 *
 * An office user (staff) may change an inspection's date and inspector and
 * nothing else: PATCH /api/inspections/:id answers 403 to any other field. The
 * Order details "Edit details" button and the agreement-required switch both
 * write those other fields, so offering them only produced a failed save.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { OrderDetailsCard } from "~/components/inspector-portal/OrderDetailsCard";
import { GateToggle } from "~/components/inspector-portal/GateToggle";

function renderCard(canEdit?: boolean) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <OrderDetailsCard
                    closingDate="2026-09-30"
                    referenceNumber="REF-7"
                    referralSource="Website"
                    referralSources={["Website"]}
                    referredByContactId={null}
                    referredByName={null}
                    {...(canEdit === undefined ? {} : { canEdit })}
                />
            ),
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

function renderGate(canEdit?: boolean) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <GateToggle
                    field="agreementRequired"
                    checked={false}
                    label="Agreement required"
                    testId="gate"
                    {...(canEdit === undefined ? {} : { canEdit })}
                />
            ),
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("OrderDetailsCard - Edit details", () => {
    it("is not offered when the viewer cannot edit, but the facts still show", async () => {
        const { queryByRole, findByText } = renderCard(false);
        expect(await findByText("REF-7")).toBeTruthy();
        expect(queryByRole("button", { name: "Edit details" })).toBeNull();
    });

    it("POSITIVE CONTROL - offered by default and when allowed", async () => {
        for (const canEdit of [undefined, true]) {
            const { findByRole, unmount } = renderCard(canEdit);
            expect(await findByRole("button", { name: "Edit details" })).toBeTruthy();
            unmount();
        }
    });
});

describe("GateToggle", () => {
    it("renders nothing when the viewer cannot edit", async () => {
        const { container } = renderGate(false);
        expect(container.querySelector('[data-testid="gate"]')).toBeNull();
        expect(container.textContent).not.toContain("Agreement required");
    });

    it("POSITIVE CONTROL - renders by default and when allowed", async () => {
        for (const canEdit of [undefined, true]) {
            const { container, unmount } = renderGate(canEdit);
            expect(container.querySelector('[data-testid="gate"]')).not.toBeNull();
            unmount();
        }
    });
});
