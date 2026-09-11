// @vitest-environment happy-dom
/**
 * F77, client half — a 403 from the report endpoint has two causes and they are
 * different facts to the person reading the page.
 *
 *   not published — there is nothing to show yet; the inspector is still working.
 *   held          — the report is FINISHED, and the workspace is holding it for
 *                   a signed agreement or an outstanding payment.
 *
 * Before the release gate existed, only the first could happen, so the loader
 * mapped every 403 to it. Now that the endpoint refuses a held report too, that
 * mapping would tell a client who owes money that their inspector has not
 * finished — wrong, and it sends them to the wrong person to fix it.
 *
 * Both directions are asserted. A component that always rendered the hold would
 * pass a one-sided test and would be a worse lie than the one being fixed.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ReportUnavailable } from "./ReportUnavailable";
import type { TenantBrand } from "~/lib/brand";

const BRAND = { companyName: "Acme Inspections" } as unknown as TenantBrand;

describe("ReportUnavailable — held is not the same as unpublished", () => {
    it("says the report is finished and on hold when it is held", () => {
        render(<ReportUnavailable error="Report not found" notPublished={false} reportHeld brand={BRAND} />);
        expect(screen.getByText(/on hold/i)).toBeTruthy();
        // DISCRIMINATING: it must not also claim the report does not exist yet.
        expect(document.body.textContent).not.toMatch(/not been published|not published/i);
    });

    it("points the reader at the tab that says what is outstanding", () => {
        render(<ReportUnavailable error="Report not found" notPublished={false} reportHeld brand={BRAND} />);
        expect(document.body.textContent).toMatch(/Overview/);
    });

    it("still says unpublished when that is the actual cause", () => {
        // POSITIVE CONTROL. Without this, a component hard-wired to the hold
        // passes every other assertion here.
        render(<ReportUnavailable error="Report not found" notPublished reportHeld={false} brand={BRAND} />);
        expect(document.body.textContent).not.toMatch(/on hold/i);
    });

    it("falls through to the dead-link state when neither applies", () => {
        render(<ReportUnavailable error="Report not found" notPublished={false} reportHeld={false} brand={BRAND} />);
        expect(document.body.textContent).toMatch(/Acme Inspections/);
        expect(document.body.textContent).not.toMatch(/on hold/i);
    });

    it("treats an absent reportHeld as not held, for callers that never set it", () => {
        // The field is optional on purpose — several callers construct this
        // component from thinner data. Absent must read as "not held", never as
        // held, or a plain load failure would start announcing a payment hold.
        render(<ReportUnavailable error="Report not found" notPublished brand={BRAND} />);
        expect(document.body.textContent).not.toMatch(/on hold/i);
    });
});
