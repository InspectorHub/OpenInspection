// @vitest-environment happy-dom
/**
 * The Lifecycle card offers each verb only where the API allows it.
 *
 * Office staff never mark a visit complete; they may cancel an unpaid job that has not
 * started, and restore one. Each verb has its own flag, so the card can offer one
 * without the others. Every withheld verb is paired with the default viewer who has it.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub, useFetcher } from "react-router";

import { LifecycleCard } from "~/components/inspector-portal/LifecycleCard";
import { INSPECTION_STATUS } from "../../../server/lib/status/inspection-status";

type Flags = { canComplete?: boolean; canCancel?: boolean; canRestore?: boolean };

function Host({ status, flags }: { status: string; flags: Flags }) {
    return <LifecycleCard status={status} inspectionId="insp-1" fetcher={useFetcher()} {...flags} />;
}

function renderCard(status: string, flags: Flags = {}) {
    const Stub = createRoutesStub([{ path: "/", Component: () => <Host status={status} flags={flags} /> }]);
    return render(<Stub initialEntries={["/"]} />);
}

const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll("button")).map((b) => b.textContent ?? "");

describe("LifecycleCard - verbs", () => {
    it("staff on an unpaid, unstarted job: Cancel without Mark complete", () => {
        const labels = buttons(renderCard(INSPECTION_STATUS.SCHEDULED, { canComplete: false }).container);
        expect(labels).toContain("Cancel inspection");
        expect(labels).not.toContain("Mark fieldwork complete");
    });

    it("staff on a paid or started job: no verb at all", () => {
        const { container } = renderCard(INSPECTION_STATUS.SCHEDULED, { canComplete: false, canCancel: false });
        expect(buttons(container)).toEqual([]);
    });

    it("withholds Restore when the flag says the server would refuse it", () => {
        const { container } = renderCard(INSPECTION_STATUS.CANCELLED, { canRestore: false });
        expect(buttons(container).some((t) => t.includes("Restore"))).toBe(false);
    });

    it("POSITIVE CONTROL - the default viewer keeps Mark fieldwork complete and Cancel", () => {
        const labels = buttons(renderCard(INSPECTION_STATUS.SCHEDULED).container);
        expect(labels).toContain("Mark fieldwork complete");
        expect(labels).toContain("Cancel inspection");
    });

    it("POSITIVE CONTROL - the default viewer keeps Restore on a cancelled inspection", () => {
        expect(buttons(renderCard(INSPECTION_STATUS.CANCELLED).container).some((t) => t.includes("Restore"))).toBe(true);
    });
});
