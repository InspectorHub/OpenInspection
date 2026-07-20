// Shared browser-timezone affordance under the tenant + agent timezone pickers.
// Detection is client-only (post-mount) and the line only appears when the
// detected zone differs from what's already in effect.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { BrowserTimezoneHint } from "./BrowserTimezoneHint";

/** Pin Intl's resolved timezone so the post-mount detection is deterministic. */
function mockBrowserZone(zone: string) {
  const real = Intl.DateTimeFormat;
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
    (...args: unknown[]) =>
      ({
        // Only resolvedOptions().timeZone is consulted by the component.
        resolvedOptions: () => ({ timeZone: zone }),
        format: (d?: Date) => new (real as unknown as typeof Intl.DateTimeFormat)(
          ...(args as ConstructorParameters<typeof Intl.DateTimeFormat>),
        ).format(d),
      }) as unknown as Intl.DateTimeFormat,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("BrowserTimezoneHint", () => {
  it("offers the detected browser zone when it differs from the effective value", () => {
    mockBrowserZone("America/Chicago");
    const onUse = vi.fn();
    const { getByRole, getByText } = render(
      <BrowserTimezoneHint effectiveValue="UTC" onUse={onUse} />,
    );
    // The offset-labelled zone is shown.
    expect(getByText(/America\/Chicago/)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /use this/i }));
    expect(onUse).toHaveBeenCalledWith("America/Chicago");
  });

  it("stays hidden when the browser zone already matches what's in effect", () => {
    mockBrowserZone("America/Chicago");
    const { container } = render(
      <BrowserTimezoneHint effectiveValue="America/Chicago" onUse={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows for an agent on 'use each company' (empty effective value)", () => {
    mockBrowserZone("Europe/London");
    const { getByRole } = render(
      <BrowserTimezoneHint effectiveValue="" onUse={vi.fn()} />,
    );
    expect(getByRole("button", { name: /use this/i })).toBeTruthy();
  });
});
