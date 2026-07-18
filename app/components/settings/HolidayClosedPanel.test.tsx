import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { HolidayClosedPanel, type HolidayConfig } from "./HolidayClosedPanel";

function renderPanel(
  config: HolidayConfig,
  coverage?: { dataMaxYear: number; currentYear: number },
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <HolidayClosedPanel
            initialConfig={config}
            initialCustomHolidays={[]}
            dataMaxYear={coverage?.dataMaxYear}
            currentYear={coverage?.currentYear}
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

const CATALOG_OFF: HolidayConfig = {
  holidayRegion: null,
  holidayPublicPolicy: "open",
  holidayInternalPolicy: "advisory",
  conciergeReviewRequired: false,
};

const CATALOG_ON: HolidayConfig = {
  holidayRegion: "US-TX",
  holidayPublicPolicy: "block",
  holidayInternalPolicy: "advisory",
  conciergeReviewRequired: false,
};

describe("HolidayClosedPanel", () => {
  it("offers the catalog switch, not a third policy", () => {
    // holidayRegion is the master switch: with no region the resolver returns
    // an empty map and every policy is inert. It belongs in the region control,
    // not masquerading as a peer of the two real policies.
    const html = renderPanel(CATALOG_OFF);
    expect(html).toContain('data-testid="holiday-region-switch"');
    expect(html).not.toContain("Holidays off");
  });

  it("hides the policy choice while the catalog is off", () => {
    // The policies only describe what happens ON a holiday. With no catalog
    // there are no holidays, so showing the controls would offer settings that
    // silently do nothing.
    const html = renderPanel(CATALOG_OFF);
    expect(html).not.toContain('data-testid="holiday-policy-row"');
    expect(html).not.toContain("Closed on holidays");
  });

  it("names what happens rather than the kind of office", () => {
    const html = renderPanel(CATALOG_ON);
    expect(html).toContain('data-testid="holiday-policy-row"');
    expect(html).toContain("Closed on holidays");
    expect(html).toContain("Open on request");
    expect(html).not.toContain("Standard office");
    expect(html).not.toContain("Holiday on-call");
  });

  it("keeps Advanced present but collapsed", () => {
    const html = renderPanel(CATALOG_ON);
    expect(html).toMatch(/<details[^>]*data-testid="holiday-advanced"/);
    expect(html).not.toMatch(/<details[^>]*open[^>]*data-testid="holiday-advanced"/);
    expect(html).not.toMatch(/<details[^>]*data-testid="holiday-advanced"[^>]*open/);
  });

  it("warns when the current year has reached the last covered data year", () => {
    const html = renderPanel(CATALOG_ON, { dataMaxYear: 2031, currentYear: 2031 });
    expect(html).toContain('data-testid="holiday-coverage-warn"');
    expect(html).toContain("2031");
  });

  it("stays quiet while covered years remain ahead", () => {
    const html = renderPanel(CATALOG_ON, { dataMaxYear: 2031, currentYear: 2026 });
    expect(html).not.toContain('data-testid="holiday-coverage-warn"');
  });

  it("does not warn about coverage when the catalog is off", () => {
    const html = renderPanel(CATALOG_OFF, { dataMaxYear: 2031, currentYear: 2035 });
    expect(html).not.toContain('data-testid="holiday-coverage-warn"');
  });

  it("keeps the open-bookings escape hatch out of the primary controls", () => {
    const html = renderPanel(CATALOG_ON);
    const policyStart = html.indexOf('data-testid="holiday-policy-row"');
    const advancedStart = html.indexOf('data-testid="holiday-advanced"');
    expect(policyStart).toBeGreaterThan(-1);
    expect(advancedStart).toBeGreaterThan(policyStart);
    const policyHtml = html.slice(policyStart, advancedStart);
    expect(policyHtml).not.toContain("Allow bookings");
  });
});
