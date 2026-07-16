import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { TimeOffListPanel } from "./TimeOffListPanel";

describe("TimeOffListPanel", () => {
  it("empty state links to /calendar to block time", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <TimeOffListPanel blocks={[]} />,
        },
      ],
      { initialEntries: ["/"] },
    );
    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain('data-testid="time-off-empty"');
    expect(html).toContain("No time off scheduled.");
    expect(html).toContain('href="/calendar"');
    expect(html).toContain("Block time on calendar");
  });

  it("lists existing blocks with calendar links", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <TimeOffListPanel
              blocks={[
                {
                  id: "b1",
                  title: "PTO",
                  date: "2026-08-01",
                  startTime: null,
                  endTime: null,
                  allDay: true,
                },
              ]}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain("PTO");
    expect(html).toContain("2026-08-01");
    expect(html).toContain("All day");
    expect(html).not.toContain('data-testid="time-off-empty"');
  });
});
