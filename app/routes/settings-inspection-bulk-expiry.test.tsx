// @vitest-environment happy-dom
/**
 * IA-36 ⑥ — the tenant-wide bulk-expiry control.
 *
 * This is a destructive action whose blast radius is every outstanding report
 * link the company has. The registry's requirement is that the button state
 * its own consequence with the real number ("Expire 47 links") instead of a
 * harmless "Apply", so the label and the visibility rules ARE the feature —
 * not decoration around it. They get assertions.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { BulkLinkExpiry } from "./settings-inspection";
import type { ReportLinkTtl } from "../../server/lib/report-link-ttl";

afterEach(cleanup);

function renderControl(ttl: ReportLinkTtl, liveLinks: number | null) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => <BulkLinkExpiry ttl={ttl} liveLinks={liveLinks} />,
      action: () => ({ ok: true, affected: 0 }),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("the button says what it is about to do", () => {
  it("names the count when applying an expiry", () => {
    renderControl({ count: 90, unit: "days" }, 47);
    expect(screen.getByRole("button", { name: "Expire 47 links" })).toBeTruthy();
  });

  it("says 'lift' rather than 'expire' when the policy is never", () => {
    renderControl("never", 47);
    expect(screen.getByRole("button", { name: "Lift expiry on 47 links" })).toBeTruthy();
  });

  it("uses the singular for exactly one link", () => {
    renderControl({ count: 90, unit: "days" }, 1);
    // "Expire 1 links" is the kind of detail that makes an operator distrust a
    // number they are being asked to act on.
    expect(screen.getByRole("button", { name: "Expire 1 link" })).toBeTruthy();
  });
});

describe("it refuses to offer an action it cannot describe", () => {
  it("renders nothing at all when the count could not be resolved", () => {
    const { container } = renderControl({ count: 90, unit: "days" }, null);
    // A button reading "Expire 0 links" that then expires 47 is strictly worse
    // than no button, so an unknown count removes the control entirely.
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("stays visible but disabled when there is nothing live to act on", () => {
    renderControl({ count: 90, unit: "days" }, 0);
    // Kept on screen so the absence reads as "none right now" rather than
    // "this product cannot do that".
    const btn = screen.getByRole("button", { name: "Expire 0 links" });
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});
