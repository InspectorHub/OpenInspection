import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { CalendarReadSetPicker, type CalendarPickerData } from "./CalendarReadSetPicker";

function render(picker: CalendarPickerData) {
  const router = createMemoryRouter(
    [{ path: "/", element: <CalendarReadSetPicker picker={picker} /> }],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

const PICKER: CalendarPickerData = {
  connectionId: "conn-1",
  writeCalendarId: "work",
  readCalendarIds: ["primary", "work"],
  calendars: [
    { id: "primary", summary: "My calendar", accessRole: "owner", primary: true },
    { id: "work", summary: "Work team", accessRole: "writer", primary: false },
    { id: "shared", summary: "Shared FYI", accessRole: "reader", primary: false },
  ],
};

describe("CalendarReadSetPicker", () => {
  it("lists every calendar as a read checkbox", () => {
    const html = render(PICKER);
    expect(html).toContain('data-testid="read-cal-primary"');
    expect(html).toContain('data-testid="read-cal-work"');
    expect(html).toContain('data-testid="read-cal-shared"');
  });

  it("locks Primary on (checked + disabled)", () => {
    const html = render(PICKER);
    const start = html.indexOf('data-testid="read-cal-primary"');
    const tag = html.slice(start - 40, start + 120);
    expect(tag).toContain("checked");
    expect(tag).toContain("disabled");
  });

  it("offers only read-selected, editable calendars as write targets", () => {
    const html = render(PICKER);
    const from = html.indexOf('data-testid="write-cal-select"');
    const to = html.indexOf("</select>", from);
    const select = html.slice(from, to);
    // primary (owner, read) and work (writer, read) are writable options...
    expect(select).toContain("My calendar");
    expect(select).toContain("Work team");
    // ...but the read-only "Shared FYI" calendar is not a write target.
    expect(select).not.toContain("Shared FYI");
  });

  it("renders the save control", () => {
    expect(render(PICKER)).toContain('data-testid="calpicker-save"');
  });
});
