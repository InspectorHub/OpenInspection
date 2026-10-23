// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { InspectionIdentity } from "./InspectionIdentity";
import { m } from "../../i18n";

afterEach(cleanup);

describe("SaveStatusIndicator", () => {
  it.each([
    ["saving", () => m.editor_header_save_saving(), "text-ih-watch-fg"],
    ["saved", () => m.editor_header_save_saved(), "text-ih-ok-fg"],
    ["error", () => m.editor_header_save_error(), "text-ih-bad-fg"],
  ] as const)("%s shows its words in its own tone", (status, text, tone) => {
    render(<SaveStatusIndicator status={status} />);
    const el = screen.getByTestId("save-status");
    expect(el.textContent).toBe(text());
    expect(el.className).toContain(tone);
  });

  it("idle shows nothing", () => {
    const { container } = render(<SaveStatusIndicator status="idle" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("InspectionIdentity", () => {
  it("shows address, short number, date and status; falls back when there is no address", () => {
    const { rerender } = render(<InspectionIdentity address="1 Main St" id="abcdef12-3456" date="Oct 5" status="draft" />);
    const el = screen.getByTestId("inspection-identity");
    expect(el.textContent).toContain("1 Main St");
    expect(el.textContent).toContain("#ABCDEF12");
    expect(el.textContent).toContain("Oct 5");
    expect(el.textContent).toContain("draft");
    rerender(<InspectionIdentity address="" id="abcdef12-3456" status="draft" />);
    expect(screen.getByTestId("inspection-identity").textContent).toContain(m.editor_header_property_fallback());
  });
});
