import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ManageTeamSchedulesBar } from "./ManageTeamSchedulesBar";

describe("ManageTeamSchedulesBar", () => {
  it("links each member to My Schedule with inspectorId", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <ManageTeamSchedulesBar
              members={[
                { id: "u1", email: "alice@example.com" },
                { id: "u2", email: "bob@example.com" },
              ]}
            />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(html).toContain("Team schedules");
    expect(html).toContain("/settings/schedule?inspectorId=u1");
    expect(html).toContain("/settings/schedule?inspectorId=u2");
    expect(html).toContain("alice@example.com");
    expect(html).toContain("Manage team schedules");
  });
});
