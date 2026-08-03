// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ServiceEditForm } from "./ServiceEditForm";

afterEach(cleanup);

const SERVICE = {
    id: "svc-1",
    name: "Full Home Inspection",
    description: "Everything except the roof",
    price: 45000,
    durationMinutes: 210,
    templateId: null as string | null,
};

const TEMPLATES = [
    { id: "tpl-1", name: "Residential Standard" },
    { id: "tpl-2", name: "Radon Measurement" },
];

function renderForm(service = SERVICE) {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => (
                <ServiceEditForm service={service} templates={TEMPLATES} onCancel={() => {}} />
            ),
        },
    ]);
    render(<Stub initialEntries={["/"]} />);
}

/**
 * Caught in the browser, not by a unit test: the form opened over an existing
 * service with NAME, DESCRIPTION and DURATION empty, showing their placeholders.
 * Conform's `defaultValue` only reaches an input that asks for it, and these did
 * not — so the form claimed the service had no name and no duration, and saving
 * would have made that true for description and duration (name would have failed
 * validation, which is the only reason this was not silent data loss).
 */
describe("ServiceEditForm — opens with the service in it", () => {
    it("fills every text field from the service", () => {
        renderForm();
        expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("Full Home Inspection");
        expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe("Everything except the roof");
        expect((screen.getByLabelText(/duration/i) as HTMLInputElement).value).toBe("210");
    });

    it("fills the price from stored cents", () => {
        renderForm();
        expect((screen.getByLabelText(/price/i) as HTMLInputElement).value).toContain("450");
    });

    it("leaves a field the service has nothing for empty, not filled with a guess", () => {
        renderForm({ ...SERVICE, description: null, durationMinutes: null });
        expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe("");
        expect((screen.getByLabelText(/duration/i) as HTMLInputElement).value).toBe("");
    });

    it("carries which service is being saved, and the update intent", () => {
        renderForm();
        const form = document.querySelector("form");
        expect(form?.querySelector('input[name="id"]')?.getAttribute("value")).toBe("svc-1");
        expect(form?.querySelector('input[name="intent"]')?.getAttribute("value")).toBe("update-service");
    });

    it("keeps the service's own template selected", () => {
        renderForm({ ...SERVICE, templateId: "tpl-2" });
        expect((screen.getByLabelText(/report template/i) as HTMLSelectElement).value).toBe("tpl-2");
    });

    it("says what a missing template costs, on a service that has none", () => {
        renderForm();
        expect(screen.getByText(/cannot book online/i)).toBeTruthy();
    });
});
