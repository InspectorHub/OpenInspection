// @vitest-environment happy-dom
/**
 * F36 — `/settings/booking` offered seven sections of configuration for a
 * booking page that was CLOSED, and opened on "Company link": the public
 * address, a Copy button and "Share the company link". The address answered
 * "Online booking isn't open yet". The page's only mention of scheduling was a
 * factual line about where weekly hours live; it never said that this was what
 * was blocking the page right now.
 *
 * Both directions are asserted here. A notice that always renders proves
 * nothing, so the OPEN case is the control: same component, same props shape,
 * nothing rendered. The unknown case (the read failed) is a control too — a
 * page must not cry closed on a fact it could not establish.
 */
import type { ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import {
  BookingClosedNotice,
  type BookingOpenState,
} from "./BookingClosedNotice";
import { CompanyBookingLinksPanel } from "./CompanyBookingLinksPanel";
import { m } from "~/paraglide/messages";

/** The notice needs a router: its "fix this" action is a <Link>. */
function renderAt(element: ReactElement) {
  const router = createMemoryRouter([{ path: "/settings/booking", element }], {
    initialEntries: ["/settings/booking"],
  });
  return render(<RouterProvider router={router} />);
}

function renderNotice(state: BookingOpenState) {
  return renderAt(<BookingClosedNotice state={state} />);
}

function renderLinksPanel(state: BookingOpenState) {
  return renderAt(<CompanyBookingLinksPanel tenant="acme" booking={state} />);
}

/** Every link in the rendered tree, as href strings. */
function hrefs(): string[] {
  return Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
}

describe("BookingClosedNotice — closed", () => {
  it("names the missing weekly hours and links to where they are set", () => {
    renderNotice({ open: false, reason: "no_inspector_hours" });

    const text = document.body.textContent ?? "";
    // Says it is closed, before anything on the page offers the link.
    expect(text).toMatch(/online booking is closed/i);
    // Names the ACTUAL blocker, not just the closed state.
    expect(text).toMatch(/weekly hours/i);
    // Quotes what a visitor is actually told, from the public page's own
    // message rather than a literal retyped in this test.
    expect(text).toContain(m.booking_not_open_heading());
    // Links to the surface that fixes it.
    expect(hrefs()).toContain("/settings/schedule");
  });

  it("names the missing company time zone and links to the workspace settings", () => {
    renderNotice({ open: false, reason: "no_company_timezone" });

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/online booking is closed/i);
    expect(text).toMatch(/time zone/i);
    expect(hrefs()).toContain("/settings/workspace");
    // The hours blocker is NOT the one being reported here.
    expect(text).not.toMatch(/weekly hours/i);
  });

  it("still says closed, and names both requirements, when no reason came back", () => {
    renderNotice({ open: false, reason: null });

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/online booking is closed/i);
    expect(text).toMatch(/weekly hours/i);
    expect(text).toMatch(/time zone/i);
  });
});

describe("BookingClosedNotice — the positive control", () => {
  it("renders nothing at all when booking is open", () => {
    const { container } = renderNotice({ open: true, reason: null });
    expect(container.textContent).toBe("");
    expect(document.body.textContent ?? "").not.toMatch(/online booking is closed/i);
  });

  it("renders nothing when the open/closed fact could not be read", () => {
    const { container } = renderNotice({ open: null, reason: null });
    expect(container.textContent).toBe("");
  });
});

describe("the company link, while booking is closed", () => {
  it("warns above the address and states the consequence beside it", async () => {
    renderLinksPanel({ open: false, reason: "no_inspector_hours" });

    const text = document.body.textContent ?? "";
    // The notice is wired into the section the page lands on...
    expect(text).toMatch(/online booking is closed/i);
    expect(text).toMatch(/weekly hours/i);
    // ...and the share instruction has become the consequence.
    expect(text).toContain(m.booking_not_open_heading());
    expect(text).not.toMatch(/share the company link/i);
    // Copy stays available: configuring a closed page is legitimate work.
    expect(await screen.findByText(m.common_copy())).toBeTruthy();
  });

  it("goes back to the sharing instruction once booking is open", () => {
    renderLinksPanel({ open: true, reason: null });

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/share the company link/i);
    expect(text).not.toMatch(/online booking is closed/i);
    expect(text).not.toContain(m.booking_not_open_heading());
  });
});
