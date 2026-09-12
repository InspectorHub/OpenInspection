// @vitest-environment happy-dom
/**
 * F4 — the Services step has to say how it relates to the Report template.
 *
 * Step 1 asks for a Report template and step 3 for Services, and in a workspace
 * whose catalogue mirrors its template library the two are near-identical lists
 * of near-identical names, two steps apart. Nothing on either screen said which
 * one decides what, so the reasonable reading — "these must line up or something
 * is wrong" — was left standing with no answer.
 *
 * What the code actually does: `templateId` is snapshotted onto the inspection
 * and becomes the primary report's template (`createInspection` →
 * `createPrimaryReport`), while the selected services become
 * `inspection_services` price snapshots — tier 2 of the money-authority chain
 * (`writeInspectionServiceSnapshots`, `getEffectivePriceCents`). Neither
 * constrains the other and nothing validates the pair.
 *
 * So the assertion is on the three things a reader needs: which one produces the
 * report, which one produces the money, and that they need not correspond.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ServicesStep } from "./ServicesStep";

afterEach(cleanup);

function renderStep() {
    return render(
        <ServicesStep
            serviceCatalog={[
                { id: "s1", name: "Radon Testing", price: 15000 },
                { id: "s2", name: "Sewer Scope", price: 22500 },
            ]}
            services={new Set<string>()}
            priceOverrides={new Map<string, number>()}
            toggleService={vi.fn()}
            handlePriceOverrideChange={vi.fn()}
        />,
    );
}

describe("ServicesStep — how services relate to the report template", () => {
    it("names the report template as the thing that decides the report", () => {
        const { container } = renderStep();
        expect(container.textContent).toMatch(/report template/i);
        expect(container.textContent).toMatch(/what the report contains/i);
    });

    it("says services decide what the client is charged", () => {
        const { container } = renderStep();
        expect(container.textContent).toMatch(/services decide what the client is charged/i);
    });

    it("answers the mismatch question instead of leaving it open", () => {
        const { container } = renderStep();
        expect(container.textContent).toMatch(/nothing here has to match the template/i);
    });
});
