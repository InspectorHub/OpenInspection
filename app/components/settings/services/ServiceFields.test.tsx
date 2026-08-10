// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ServiceFields, type ServiceFieldMetas } from "./ServiceFields";
import { asSelect } from "../../../../tests/helpers/dom";

afterEach(cleanup);

const meta = (name: string) => ({ id: `f-${name}`, name });
const FIELDS: ServiceFieldMetas = {
    name: meta("name"),
    description: meta("description"),
    price: meta("price"),
    durationMinutes: meta("durationMinutes"),
    templateId: meta("templateId"),
};

function renderFields(templates: Array<{ id: string; name: string }>, initialTemplateId = "") {
    // Renders a <Link> in the no-templates branch, so it needs router context.
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <ServiceFields fields={FIELDS} templates={templates} initialTemplateId={initialTemplateId} />
            ),
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

const TWO = [
    { id: "tpl-1", name: "Residential Standard" },
    { id: "tpl-2", name: "Radon Measurement" },
];

/**
 * The template field's default used to be the value that breaks the product: a
 * service with no template makes any online booking that picks it fail in front
 * of the customer. The form said nothing about that; the consequence arrived
 * afterwards, as a red line in the table. State the cost where the choice is.
 */
describe("ServiceFields — the template's cost is stated at the choice", () => {
    it("says what leaving it blank costs, while it is blank", () => {
        renderFields(TWO);
        expect(screen.getByText(/cannot book online/i)).toBeTruthy();
    });

    it("stops saying it once a template is chosen", () => {
        renderFields(TWO);
        fireEvent.change(screen.getByLabelText(/report template/i), { target: { value: "tpl-2" } });
        expect(screen.queryByText(/cannot book online/i)).toBeNull();
    });

    it("preselects the only template there is — that is not a choice to make", () => {
        renderFields([TWO[0]]);
        expect(asSelect(screen.getByLabelText(/report template/i)).value).toBe("tpl-1");
        expect(screen.queryByText(/cannot book online/i)).toBeNull();
    });

    it("keeps the service's own template when editing, over the only-one rule", () => {
        renderFields(TWO, "tpl-2");
        expect(asSelect(screen.getByLabelText(/report template/i)).value).toBe("tpl-2");
    });

    it("points at where to make one when the workspace has none", () => {
        renderFields([]);
        expect(screen.queryByLabelText(/report template/i)).toBeNull();
        expect(screen.getByRole("link", { name: /create a template/i })).toBeTruthy();
    });
});

describe("ServiceFields — price and duration are the two quantities of a service", () => {
    it("puts them next to each other, not at opposite corners", () => {
        renderFields(TWO);
        const inputs = Array.from(document.querySelectorAll("input,select")).map((el) =>
            el.getAttribute("name"),
        );
        const price = inputs.indexOf("price");
        const duration = inputs.indexOf("durationMinutes");
        expect(price).toBeGreaterThan(-1);
        expect(duration).toBeGreaterThan(price);
        // Nothing but price's own hidden dollars field between them.
        expect(duration - price).toBeLessThanOrEqual(2);
    });
});
