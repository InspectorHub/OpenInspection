// @vitest-environment happy-dom
/**
 * Without the `inspectionFees` capability the service catalogue arrives with no
 * prices. The step must not offer a price field (the create request would be
 * refused if it carried an override) and must not show a $0.00 total.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ServicesStep } from "./ServicesStep";

afterEach(cleanup);

function renderStep(catalog: Array<{ id: string; name: string; price?: number }>) {
    return render(
        <ServicesStep
            serviceCatalog={catalog}
            services={new Set<string>(["s1"])}
            priceOverrides={new Map<string, number>()}
            toggleService={vi.fn()}
            handlePriceOverrideChange={vi.fn()}
        />,
    );
}

describe("ServicesStep — hidden prices", () => {
    it("positive control: with prices, the selected service has a price field and a total", () => {
        const { container } = renderStep([{ id: "s1", name: "Radon Testing", price: 15000 }]);
        expect(container.querySelectorAll("input").length).toBe(1);
        expect(container.textContent).toContain("$150.00");
    });

    it("offers no price field and no total when prices are absent", () => {
        const { container } = renderStep([{ id: "s1", name: "Radon Testing" }]);
        expect(container.textContent).toContain("Radon Testing");
        expect(container.querySelectorAll("input").length).toBe(0);
        expect(container.textContent).not.toContain("$0.00");
    });
});
