// @vitest-environment happy-dom
/**
 * F37 — the closed booking page must not be a dead end.
 *
 * It rendered `{company} hasn't opened online scheduling yet. Please contact them
 * directly to book your inspection.` and then, below that, a Privacy Policy and a
 * Terms of Service link. No phone, no email, no website. A potential customer who
 * followed a shared booking link was told to make contact and given nothing to
 * make contact with.
 *
 * The details were already in the product: `TenantBrand.supportEmail` /
 * `companyPhone` have been served by `GET /api/public/brand/:tenant` since IA-36
 * ⑨, and this component was already being handed the brand. They were simply
 * never rendered. (The walkthrough inspected `CompanyProfile`, which does not
 * carry them, and concluded the loader needed changing. It does not.)
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { BookingNotOpenState } from "~/components/booking/BookingShell";
import { EMPTY_BRAND, type TenantBrand } from "~/lib/brand";
import type { CompanyProfile } from "~/components/booking/booking-constants";

const PROFILE: CompanyProfile = {
    company: "Acme Inspections",
    bookingOpen: false,
    inspectors: [],
    services: [],
};

function brand(over: Partial<TenantBrand> = {}): TenantBrand {
    return { ...EMPTY_BRAND, companyName: "Acme Inspections", ...over };
}

function renderClosed(b: TenantBrand) {
    render(
        <BookingNotOpenState
            profile={PROFILE}
            brand={b}
            privacyUrl="/legal/acme/privacy"
            termsUrl="/legal/acme/terms"
        />,
    );
}

/** Every link on the page, as href strings. */
function hrefs(): string[] {
    return Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
}

describe("closed booking page — how a visitor reaches the company", () => {
    it("gives the email and phone as working links", () => {
        renderClosed(brand({ supportEmail: "hello@acme.test", companyPhone: "(555) 010-2030" }));
        expect(hrefs()).toContain("mailto:hello@acme.test");
        // tel: strips the formatting; the label keeps it.
        expect(hrefs()).toContain("tel:5550102030");
        expect(screen.getByText("(555) 010-2030")).toBeTruthy();
        // The copy may go on asking them to make contact, because now they can.
        expect(document.body.textContent).toMatch(/contact them directly/i);
    });

    it("shows whichever single channel the company set", () => {
        renderClosed(brand({ supportEmail: "hello@acme.test", companyPhone: null }));
        expect(hrefs()).toContain("mailto:hello@acme.test");
        expect(hrefs().some((h) => h.startsWith("tel:"))).toBe(false);
    });

    // THE DISCRIMINATING PAIR: with no channel at all, the page must stop
    // promising one. "Contact them directly" over an empty block is the dead end
    // this finding is about, and it would still pass the first test above.
    it("stops telling the visitor to make contact when there is no channel", () => {
        renderClosed(brand({ supportEmail: null, companyPhone: null }));
        expect(document.body.textContent).not.toMatch(/contact them directly/i);
        expect(hrefs().some((h) => h.startsWith("mailto:") || h.startsWith("tel:"))).toBe(false);
        // It still says what is going on, and what will change.
        expect(document.body.textContent).toMatch(/Acme Inspections/);
        expect(document.body.textContent).toMatch(/as soon as they do/i);
    });

    it("still carries the legal footer it always had", () => {
        renderClosed(brand({ supportEmail: "hello@acme.test" }));
        expect(hrefs()).toContain("/legal/acme/privacy");
        expect(hrefs()).toContain("/legal/acme/terms");
    });
});
