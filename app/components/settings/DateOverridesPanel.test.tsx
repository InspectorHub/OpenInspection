import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DateOverridesPanel } from "./DateOverridesPanel";

describe("DateOverridesPanel", () => {
  it("is read-only Synced & legacy with no Add block button", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <DateOverridesPanel
              initialOverrides={[
                {
                  id: "o1",
                  date: "2026-07-20",
                  isAvailable: false,
                  startTime: null,
                  endTime: null,
                },
              ]}
              inspectorId={null}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain("Synced &amp; legacy");
    expect(html).toContain("2026-07-20");
    expect(html).toContain('href="/calendar"');
    expect(html).toContain("Block time");
    expect(html).not.toContain("Add block");
    expect(html).not.toContain("Block date");
    expect(html).not.toContain("Pick a date first");
    expect(html).not.toMatch(/type="date"/);
  });

  it("renders nothing when there are no legacy overrides", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <DateOverridesPanel initialOverrides={[]} inspectorId={null} />,
        },
      ],
      { initialEntries: ["/"] },
    );
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toBe("");
  });
});
