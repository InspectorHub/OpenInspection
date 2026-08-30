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
    "Acme Inspect provides this template as a software implementation of Florida Office of Insurance Regulation Uniform Mitigation Verification Inspection Form, revision Rev. 04/26, effective 2026-04-01.",
    "The inspector is responsible for the accuracy of inspection findings and certifications and for complying with applicable laws and regulations.",
    `If Acme Inspect’s rendering of the identified form differs from the applicable official form, ${LOAD_BEARING}.`,
].join("\n\n");

const PROPS = {
    formTitle: "Florida Office of Insurance Regulation Uniform Mitigation Verification Inspection Form",
    revision: "Rev. 04/26",
    effectiveDate: "2026-04-01",
    notice: NOTICE,
};

describe("StatutoryFormNotice", () => {
    it("cites the form by the authority's title, the revision and the effective date", () => {
        render(<StatutoryFormNotice {...PROPS} />);
        expect(screen.getByText(PROPS.formTitle)).toBeInTheDocument();
        expect(screen.getByText(PROPS.revision)).toBeInTheDocument();
        expect(screen.getByText(PROPS.effectiveDate)).toBeInTheDocument();
    });

    it("NEGATIVE CONTROL - our internal form id is never shown to an inspector", () => {
        // `formId` is a database key. An inspector recognises the title the form
        // prints and the revision label beside it; `fl_oir_b1_1802` appears on
        // no form and on no agency page. Asserted as ABSENCE OF THE SHAPE, not
        // of one literal: any snake_cased token would be the same fault under a
        // different name.
        //
        // The assertion is a bare underscore, and the first draft was not: it
        // was an anchored token pattern, and it PASSED with `fl_oir_b1_1802` on
        // screen. `container.textContent` concatenates adjacent elements with no
        // separator -- the real string reads `Formfl_oir_b1_1802RevisionRev.` --
        // so every word boundary the pattern anchored on had been welded shut.
        // Found by planting the id and watching this line stay green.
        //
        // No authority's form title, revision label or notice prose contains an
        // underscore. Ours are the only tokens that do, which makes the
        // character itself the whole test.
        const { container } = render(<StatutoryFormNotice {...PROPS} />);
        const text = container.textContent ?? "";
        expect(text.length).toBeGreaterThan(0);          // the scan looked at something
        expect(text).not.toContain("_");
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

    it("POSITIVE CONTROL - opening the notice is what produces the download link", () => {
        // Without this the assertion above passes on a component that renders
        // nothing at all.
        render(<StatutoryDeliverable {...DELIVERABLE} />);
        fireEvent.click(screen.getByRole("button", { name: /statutory form/i }));
        expect(screen.getByRole("link", { name: /download statutory form/i }))
            .toHaveAttribute("href", DELIVERABLE.href);
    });

    it("the primary control IS the download, in one click, carrying the title's verb", () => {
        // The dialog is titled "Before you download this statutory form", so its
        // primary says Download - not Continue, and not a step that swaps a
        // control somewhere else for the reader to find and click again.
        render(<StatutoryDeliverable {...DELIVERABLE} />);
        fireEvent.click(screen.getByRole("button", { name: /statutory form/i }));
        const link = screen.getByRole("link", { name: /download statutory form/i });
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        // A real link, not a scripted download: the user gesture is preserved
        // and no popup blocker is in the way.
        expect(link.tagName).toBe("A");
        expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    });

    it("shows the notice inside the modal, not a reference to it", () => {
        // A modal saying "please review the notice" would satisfy a flow test
        // while showing the reader nothing.
        render(<StatutoryDeliverable {...DELIVERABLE} />);
        fireEvent.click(screen.getByRole("button", { name: /statutory form/i }));
        expect(screen.getByText(new RegExp(LOAD_BEARING))).toBeInTheDocument();
    });

    it("dismissing leaves the download unreachable", () => {
        render(<StatutoryDeliverable {...DELIVERABLE} />);
        fireEvent.click(screen.getByRole("button", { name: /statutory form/i }));
        fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
        expect(screen.queryByRole("link", { name: /statutory form/i })).toBeNull();
    });

    it("NOTHING IS REMEMBERED - a second download shows the notice again", () => {
        // The regression the `acknowledged` flag caused: once set, the link
        // stayed on the page and every later download showed the reader
        // nothing. Downloading and reopening must land back at the notice.
        render(<StatutoryDeliverable {...DELIVERABLE} />);
        fireEvent.click(screen.getByRole("button", { name: /statutory form/i }));
        const link = screen.getByRole("link", { name: /download statutory form/i });
        // happy-dom follows a real href on click and prints a fetch failure for
        // a server that is not running. The navigation is not what is under
        // test here; React's onClick still runs, which is.
        link.addEventListener("click", (e) => { e.preventDefault(); }, { once: true });
        fireEvent.click(link);
        expect(screen.queryByRole("link", { name: /download statutory form/i })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: /statutory form/i }));
        expect(screen.getByText(new RegExp(LOAD_BEARING))).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /download statutory form/i })).toBeInTheDocument();
    });
});
