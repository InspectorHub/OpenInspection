// @vitest-environment happy-dom
/**
 * `inspection_events` had a table, a full CRUD API and an automation trigger per
 * transition — and no frontend, which is why production holds zero rows.
 *
 * The half of that worth pinning is not "does a list render" but WHO IS INVITED
 * TO DO WHAT. Completing a visit is the field's own act: the inspector standing
 * in the crawlspace is the person who knows it is over. Recording that the lab
 * results ARRIVED is an office act about a different moment entirely — the
 * sample reaching the lab is not the inspector finishing — and a card that
 * offers it to an inspector is a card offering an action the server refuses.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import {
    VisitRow,
    VisitsCard,
    visitActions,
    type VisitRowData,
    type VisitTypeOption,
} from "./VisitsCard";

const TYPE: VisitTypeOption = {
    id: "et-radon-pickup",
    name: "Radon pickup",
    slug: "radon_pickup",
    defaultDurationMin: 20,
    color: "#4a72ff",
    active: true,
};

const SCHEDULED: VisitRowData = {
    id: "ev1",
    eventTypeId: TYPE.id,
    scheduledAt: "2026-08-06T15:00:00.000Z",
    durationMin: 20,
    status: "scheduled",
    notes: null,
    completedAt: null,
    resultsReceivedAt: null,
    cancelledAt: null,
};

const COMPLETED: VisitRowData = {
    ...SCHEDULED,
    status: "completed",
    completedAt: "2026-08-06T15:25:00.000Z",
};

const fmt = (iso: string) => iso.slice(0, 16);

function renderRow(visit: VisitRowData, role: string) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <ul>
                    <VisitRow
                        visit={visit}
                        typeName={TYPE.name}
                        role={role}
                        formatDate={fmt}
                        onAction={vi.fn()}
                    />
                </ul>
            ),
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

function renderCard(props: Partial<Parameters<typeof VisitsCard>[0]> = {}) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <VisitsCard
                    visits={[SCHEDULED]}
                    visitTypes={[TYPE]}
                    suggestedTypeIds={[]}
                    role="owner"
                    formatDate={fmt}
                    {...props}
                />
            ),
            action: () => ({ ok: true }),
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("visitActions", () => {
    it("offers completion to the field", () => {
        expect(visitActions("inspector", "scheduled")).toContain("complete");
    });
    it("keeps results-received in the office", () => {
        expect(visitActions("inspector", "completed")).not.toContain("results");
        expect(visitActions("owner", "completed")).toContain("results");
        expect(visitActions("manager", "completed")).toContain("results");
    });
    it("offers nothing on a terminal visit", () => {
        expect(visitActions("owner", "results_received")).toEqual([]);
        expect(visitActions("owner", "cancelled")).toEqual([]);
    });
});

describe("VisitRow", () => {
    it("offers the complete action to an inspector", () => {
        renderRow(SCHEDULED, "inspector");
        expect(screen.getByRole("button", { name: /complete/i })).toBeEnabled();
    });

    it("does not offer results-received to an inspector", () => {
        // Office action, different actor. The gate is enforced server-side; this
        // only checks the UI does not invite it.
        renderRow(COMPLETED, "inspector");
        expect(screen.queryByRole("button", { name: /results/i })).toBeNull();
    });

    it("offers results-received to a manager once the visit is completed", () => {
        renderRow(COMPLETED, "manager");
        expect(screen.getByRole("button", { name: /results/i })).toBeEnabled();
    });

    it("shows the transition trail it can prove", () => {
        renderRow(COMPLETED, "owner");
        expect(screen.getByTestId("hub-visit-row").textContent).toContain("2026-08-06T15:25");
    });
});

describe("VisitsCard", () => {
    it("says the inspection has no visits rather than rendering an empty list", () => {
        renderCard({ visits: [] });
        expect(screen.queryByTestId("hub-visits-list")).toBeNull();
        expect(screen.getByText(/no visits/i)).toBeTruthy();
    });

    it("names the visit by its type", () => {
        renderCard();
        expect(screen.getByTestId("hub-visit-row").textContent).toContain("Radon pickup");
    });

    it("does not offer the add verb to an inspector", () => {
        renderCard({ role: "inspector" });
        expect(screen.queryByRole("button", { name: /add visit/i })).toBeNull();
    });

    it("leads the picker with the visit types this inspection's services imply", () => {
        const other: VisitTypeOption = { ...TYPE, id: "et-sewer", name: "Sewer scope", slug: "sewer_scope" };
        renderCard({ visitTypes: [other, TYPE], suggestedTypeIds: [TYPE.id] });
        fireEvent.click(screen.getByRole("button", { name: /add visit/i }));
        const groups = Array.from(document.querySelectorAll("optgroup")).map((g) => g.label);
        expect(groups[0]).toMatch(/suggested/i);
        const suggestedOptions = Array.from(
            document.querySelectorAll("optgroup")[0].querySelectorAll("option"),
        ).map((o) => o.textContent);
        expect(suggestedOptions).toEqual(["Radon pickup"]);
    });
});
