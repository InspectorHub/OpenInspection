// Viewer timezone for public, unauthenticated surfaces (no tenant, no session).
// SSR-safe: "UTC" until mount, then a remembered choice or the browser zone.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import {
  ViewerTimeZoneProvider,
  useViewerTimeZone,
} from "./viewer-timezone";

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

function Probe() {
  return <span data-testid="tz">{useViewerTimeZone()}</span>;
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("useViewerTimeZone", () => {
  it("returns UTC outside a provider (SSR-safe default)", () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("tz").textContent).toBe("UTC");
  });

  it("resolves to the detected browser zone after mount", () => {
    mockBrowserZone("America/Chicago");
    const { getByTestId } = render(
      <ViewerTimeZoneProvider>
        <Probe />
      </ViewerTimeZoneProvider>,
    );
    expect(getByTestId("tz").textContent).toBe("America/Chicago");
  });

  it("prefers a remembered choice over the detected zone", () => {
    localStorage.setItem("oi-viewer-tz", "Europe/London");
    mockBrowserZone("America/Chicago");
    const { getByTestId } = render(
      <ViewerTimeZoneProvider>
        <Probe />
      </ViewerTimeZoneProvider>,
    );
    expect(getByTestId("tz").textContent).toBe("Europe/London");
  });

  it("ignores a non-canonical detected alias and stays on UTC", () => {
    mockBrowserZone("Not/AZone");
    const { getByTestId } = render(
      <ViewerTimeZoneProvider>
        <Probe />
      </ViewerTimeZoneProvider>,
    );
    expect(getByTestId("tz").textContent).toBe("UTC");
  });
});
