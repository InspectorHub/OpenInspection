// @vitest-environment happy-dom
/**
 * Intuit's Disconnect URL.
 *
 * A tenant who disconnects our app from THEIR side — QuickBooks, Apps, My Apps
 * — is redirected here. Intuit requires the page to exist, to say the
 * connection has ended, and to explain how to reconnect.
 *
 * The constraint that shapes it: that redirect is a cross-site navigation
 * carrying none of our cookies. There is no session, no tenant, and nothing
 * here may read or write tenant data. Anyone on the internet can load this URL,
 * so the page has to be safe when they do — which is why it is static and why
 * these tests never mock a loader.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import Route from "./integrations-quickbooks-disconnected";

const PATH = "/integrations/quickbooks/disconnected";

function renderPage() {
  const Stub = createRoutesStub([{ path: PATH, Component: Route }]);
  return render(<Stub initialEntries={[PATH]} />);
}

describe("QuickBooks disconnect landing page", () => {
  it("says the connection has ended", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: /quickbooks disconnected/i }),
    ).toBeInTheDocument();
  });

  it("explains how to reconnect, which is what Intuit asks the page to do", async () => {
    renderPage();

    await screen.findByRole("heading", { name: /quickbooks disconnected/i });
    const steps = screen.getAllByRole("listitem");
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("link", { name: /quickbooks settings/i }))
      .toHaveAttribute("href", "/settings/integrations/qbo");
  });

  it("says nothing was deleted, because nothing was", async () => {
    // The tenant just revoked access from the QuickBooks side and has no way to
    // know whether their invoices survived. They did: disconnecting drops our
    // mapping, not their books.
    renderPage();

    expect(await screen.findByText(/nothing was deleted/i)).toBeInTheDocument();
  });

  it("renders without a loader, because it will be reached without a session", () => {
    // If this page ever grows a loader that resolves a tenant, this stub — which
    // supplies none — is what fails. That is the point: Intuit's redirect
    // carries no cookie of ours.
    expect(() => renderPage()).not.toThrow();
  });
});
