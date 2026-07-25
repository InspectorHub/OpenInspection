import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ServicesCatalogPanel } from "./ServicesCatalogPanel";

/**
 * The catalog table used to hard-code an em dash in its DURATION column, because
 * no form could set a duration — so the column was decoration. It also said
 * nothing about the template, even though a service with no template makes any
 * booking that selects it fail with "Service 'X' has no template configured",
 * which the CUSTOMER sees and the admin has no way to anticipate.
 */
function renderPanel(services: Parameters<typeof ServicesCatalogPanel>[0]["services"]) {
    // The panel renders <Form> for the activate/deactivate action, so it needs a
    // router context.
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <ServicesCatalogPanel
                    services={services}
                    restrictionMap={{}}
                    members={[]}
                    templateNames={{ "tpl-1": "Residential Standard" }}
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
        expect(screen.getByText("1 hr 30 min")).toBeTruthy();
    });

    it("renders whole hours and bare minutes without a zero component", () => {
        renderPanel([
            { ...base, id: "a", name: "A", durationMinutes: 120, templateId: "tpl-1" },
            { ...base, id: "b", name: "B", durationMinutes: 45, templateId: "tpl-1" },
        ]);
        expect(screen.getByText("2 hr")).toBeTruthy();
        expect(screen.getByText("45 min")).toBeTruthy();
    });

    it("says a duration is not set rather than showing a bare dash", () => {
        renderPanel([{ ...base, templateId: "tpl-1" }]);
        expect(screen.getByText("Not set")).toBeTruthy();
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
