import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { HolidayAdvisoryBanner } from "./HolidayAdvisoryBanner";

describe("HolidayAdvisoryBanner", () => {
  it("uses concierge confirmation copy when review is required", () => {
    const html = renderToStaticMarkup(
      <HolidayAdvisoryBanner name="Thanksgiving Day" conciergeReviewRequired />,
    );
    expect(html).toContain("Request received — office will confirm.");
  });

  it("uses soft advisory copy when concierge is off", () => {
    const html = renderToStaticMarkup(
      <HolidayAdvisoryBanner name="Thanksgiving Day" conciergeReviewRequired={false} />,
    );
    // SSR escapes the apostrophe as &#x27;
    expect(html).toContain("We&#x27;ll confirm availability.");
    expect(html).not.toContain("Request received — office will confirm.");
  });
});
