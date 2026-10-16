// @vitest-environment happy-dom
/**
 * The Lifecycle card offers no verb to a viewer the API refuses them.
 *
 * Marking fieldwork complete, cancelling and restoring (POST /:id/complete,
 * /cancel, /uncancel) answer 403 to an office user (staff). The card shows the
 * status and nothing to press; every other viewer keeps all three.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";

import { LifecycleCard } from "~/components/inspector-portal/LifecycleCard";
import { INSPECTION_STATUS } from "../../../server/lib/status/inspection-status";

function Host({ status, canChangeStatus }: { status: string; canChangeStatus?: boolean }) {
    return (
        <LifecycleCard
            status={status}
            inspectionId="insp-1"
            fetcher={useFetcher()}
            {...(canChangeStatus === undefined ? {} : { canChangeStatus })}
        />
    );
}

function renderCard(status: string, canChangeStatus?: boolean) {
    const Stub = createRoutesStub([
        { path: "/", Component: () => <Host status={status} canChangeStatus={canChangeStatus} /> },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll("button")).map((b) => b.textContent ?? "");

describe("LifecycleCard - verbs for a viewer who cannot change status", () => {
    it("shows no complete or cancel button on an active inspection", () => {
        const { container } = renderCard(INSPECTION_STATUS.SCHEDULED, false);
        expect(buttons(container)).toEqual([]);
    });

    it("shows no Restore on a cancelled inspection", () => {
        const { container } = renderCard(INSPECTION_STATUS.CANCELLED, false);
        expect(buttons(container).some((t) => t.includes("Restore"))).toBe(false);
    });

    it("POSITIVE CONTROL - everyone else keeps Mark fieldwork complete and Cancel", () => {
        for (const canChange of [undefined, true]) {
            const { container, unmount } = renderCard(INSPECTION_STATUS.SCHEDULED, canChange);
            const labels = buttons(container);
            expect(labels).toContain("Mark fieldwork complete");
            expect(labels).toContain("Cancel inspection");
            unmount();
        }
    });

    it("POSITIVE CONTROL - everyone else keeps Restore on a cancelled inspection", () => {
        const { container } = renderCard(INSPECTION_STATUS.CANCELLED);
        expect(buttons(container).some((t) => t.includes("Restore"))).toBe(true);
    });
});
