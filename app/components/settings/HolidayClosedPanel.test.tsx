import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { HolidayClosedPanel } from "./HolidayClosedPanel";

describe("HolidayClosedPanel G3", () => {
  it("renders Advanced closed and keeps open public policy out of the preset row", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <HolidayClosedPanel
              initialConfig={{
                holidayRegion: null,
                holidayPublicPolicy: "open",
                holidayInternalPolicy: "advisory",
                conciergeReviewRequired: false,
              }}
              initialCustomHolidays={[]}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain("data-testid=\"holiday-preset-row\"");
    expect(html).toContain("Standard office");
    expect(html).toContain("Holiday on-call");
    expect(html).toContain("Holidays off");

    // Advanced exists but is a closed <details> (no open attribute on first paint).
    expect(html).toMatch(/<details[^>]*data-testid="holiday-advanced"/);
    expect(html).not.toMatch(/<details[^>]*open[^>]*data-testid="holiday-advanced"/);
    expect(html).not.toMatch(/<details[^>]*data-testid="holiday-advanced"[^>]*open/);

    // Preset row must not offer the "Allow bookings" (open) public policy control.
    const presetStart = html.indexOf('data-testid="holiday-preset-row"');
    const advancedStart = html.indexOf('data-testid="holiday-advanced"');
    expect(presetStart).toBeGreaterThan(-1);
    expect(advancedStart).toBeGreaterThan(presetStart);
    const presetHtml = html.slice(presetStart, advancedStart);
    expect(presetHtml).not.toContain("Allow bookings");
    expect(presetHtml).not.toContain("holiday-public-policy-advanced");
  });
});
