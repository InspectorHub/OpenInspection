import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { CompanyClosedStrip } from "./CompanyClosedStrip";

describe("CompanyClosedStrip", () => {
  it("shows next closed dates and public policy label", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <CompanyClosedStrip
              holidayRegion="US"
              holidayPublicPolicy="block"
              upcomingClosed={[
                { date: "2026-11-26", name: "Thanksgiving Day" },
                { date: "2026-12-25", name: "Christmas Day" },
              ]}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain("Company closed days");
    expect(html).toContain("Public booking:");
    expect(html).toContain("Blocked");
    expect(html).toContain("Thanksgiving Day");
    expect(html).toContain("2026-11-26");
  });
});
