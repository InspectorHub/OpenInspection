// "Times shown in {zone}" affordance for public pages that anchor dates to the
// viewer's own browser zone. Names the zone in effect and lets the viewer switch.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ViewerTimeZoneProvider } from "~/lib/viewer-timezone";
import { ViewerTimeZoneNotice } from "./ViewerTimeZoneNotice";

/** Pin Intl's resolved timezone so the post-mount detection is deterministic. */
function mockBrowserZone(zone: string) {
  const real = Intl.DateTimeFormat;
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
    (...args: unknown[]) =>
      ({
        resolvedOptions: () => ({ timeZone: zone }),
        format: (d?: Date) =>
          new (real as unknown as typeof Intl.DateTimeFormat)(
            ...(args as ConstructorParameters<typeof Intl.DateTimeFormat>),
          ).format(d),
      }) as unknown as Intl.DateTimeFormat,
  );
}

function renderNotice() {
  return render(
    <ViewerTimeZoneProvider>
      <ViewerTimeZoneNotice />
    </ViewerTimeZoneProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("ViewerTimeZoneNotice", () => {
  it("names the detected zone and lets the viewer switch (persisted)", () => {
    mockBrowserZone("America/Chicago");
    const { getByText, getByRole } = renderNotice();

    expect(getByText(/Times shown in/i)).toBeTruthy();
    const select = getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("America/Chicago");

    fireEvent.change(select, { target: { value: "America/New_York" } });
    expect(select.value).toBe("America/New_York");
    expect(localStorage.getItem("oi-viewer-tz")).toBe("America/New_York");
  });

  it("shows the 'detected from your browser' note only while on the detected zone", () => {
    mockBrowserZone("America/Chicago");
    const { getByText, queryByText, getByRole } = renderNotice();

    expect(getByText(/Detected from your browser/i)).toBeTruthy();
    fireEvent.change(getByRole("combobox"), { target: { value: "America/New_York" } });
    expect(queryByText(/Detected from your browser/i)).toBeNull();
  });

  it("renders nothing before the browser zone resolves (unresolvable)", () => {
    mockBrowserZone("");
    const { container } = renderNotice();
    expect(container.textContent).toBe("");
  });
});
