// @vitest-environment happy-dom
/**
 * The notice a person reads before a statutory form is handed to them.
 *
 * The copy is NOT asserted against literals here. It arrives from the server
 * (`server/lib/statutory/disclaimer.ts`), which is where the copy gate and the
 * non-translatable registry can both see it; a component that hard-coded the
 * sentences would be invisible to both. So these tests assert that what the
 * server sent is what the reader sees, and that the download is not reachable
 * before it has been.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatutoryFormNotice } from "./StatutoryFormNotice";
import { StatutoryDeliverable } from "./StatutoryDeliverable";

const LOAD_BEARING =
    "that difference is not made the inspector’s responsibility merely by this notice";

const NOTICE = [
    "Acme Inspect provides this template as a software implementation of fl_oir_b1_1802, revision Rev. 04/26, effective 2026-04-01.",
    "The inspector is responsible for the accuracy of inspection findings and certifications and for complying with applicable laws and regulations.",
    `If Acme Inspect’s rendering of the identified form differs from the applicable official form, ${LOAD_BEARING}.`,
].join("\n\n");

const PROPS = {
    formId: "fl_oir_b1_1802",
    revision: "Rev. 04/26",
    effectiveDate: "2026-04-01",
    notice: NOTICE,
};

describe("StatutoryFormNotice", () => {
    it("shows the official identifier, the revision and the effective date", () => {
        render(<StatutoryFormNotice {...PROPS} />);
        expect(screen.getByText(PROPS.formId)).toBeInTheDocument();
        expect(screen.getByText(PROPS.revision)).toBeInTheDocument();
        expect(screen.getByText(PROPS.effectiveDate)).toBeInTheDocument();
    });

    it("states who is responsible for the inspection and its accuracy", () => {
        render(<StatutoryFormNotice {...PROPS} />);
        expect(screen.getByText(/inspector is responsible/i)).toBeInTheDocument();
    });

    it("renders the closing sentence in full", () => {
        // Whole, not truncated. The clause is what makes this an allocation
        // statement rather than an attempt to shift a rendering fault.
        render(<StatutoryFormNotice {...PROPS} />);
        expect(screen.getByText(new RegExp(LOAD_BEARING))).toBeInTheDocument();
    });

    it("renders every paragraph the server sent, not a summary of them", () => {
        // A component that dropped a paragraph would still pass the three
        // assertions above.
        render(<StatutoryFormNotice {...PROPS} />);
        for (const paragraph of NOTICE.split("\n\n")) {
            expect(screen.getByText(paragraph.trim())).toBeInTheDocument();
        }
    });
});

describe("StatutoryDeliverable", () => {
    const DELIVERABLE = { ...PROPS, href: "/api/inspections/insp-1/statutory-form.pdf" };

    it("the download is not reachable before the notice has been shown", () => {
        // "No silent statutory form": a bare download control hands somebody a
        // state document without them ever seeing what we declared about it.
        render(<StatutoryDeliverable {...DELIVERABLE} />);
        expect(screen.queryByRole("link", { name: /statutory form/i })).toBeNull();
    });

    it("POSITIVE CONTROL — after confirming, the download link is present", () => {
        render(<StatutoryDeliverable {...DELIVERABLE} />);
        fireEvent.click(screen.getByRole("button", { name: /statutory form/i }));
        fireEvent.click(screen.getByRole("button", { name: /continue/i }));
        expect(screen.getByRole("link", { name: /statutory form/i }))
            .toHaveAttribute("href", DELIVERABLE.href);
    });

    it("shows the notice inside the modal, not a reference to it", () => {
        // A modal saying "please review the notice" would satisfy a flow test
        // while showing the reader nothing.
        render(<StatutoryDeliverable {...DELIVERABLE} />);
        fireEvent.click(screen.getByRole("button", { name: /statutory form/i }));
        expect(screen.getByText(new RegExp(LOAD_BEARING))).toBeInTheDocument();
    });

    it("dismissing without continuing leaves the download unreachable", () => {
        render(<StatutoryDeliverable {...DELIVERABLE} />);
        fireEvent.click(screen.getByRole("button", { name: /statutory form/i }));
        fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
        expect(screen.queryByRole("link", { name: /statutory form/i })).toBeNull();
    });
});
