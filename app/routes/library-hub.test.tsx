// @vitest-environment happy-dom
/**
 * The Marketplace is a SaaS-only surface.
 *
 * In standalone there is no catalogue and no way for one to arrive, so the hub
 * tile led to a permanently empty page — the "Marketplace is empty" screen the
 * content-delivery spec exists because of. Two halves, both asserted here: the
 * tile is not offered, and the route itself refuses rather than rendering an
 * empty list (a 404 is the honest answer to a page that cannot have content).
 *
 * The API handlers under `server/api/marketplace.ts` are deliberately NOT
 * gated — they are harmless once nothing links to them, and the marketplace
 * unification work reuses them.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import LibraryHub from "~/routes/library-hub";
import { loader as marketplaceLoader } from "~/routes/marketplace";
import { createLoadContext } from "~/lib/load-context";

function renderHub(isSaas: boolean) {
  const Stub = createRoutesStub([
    {
      // The id `useSessionContext` reads through `useRouteLoaderData`.
      id: "routes/auth-layout",
      path: "/",
      loader: () => ({ context: { branding: { isSaas } } }),
      Component: () => <Outlet />,
      children: [{ path: "library", Component: LibraryHub }],
    },
  ]);
  return render(<Stub initialEntries={["/library"]} />);
}

describe("library hub marketplace tile", () => {
  it("offers the Marketplace tile in SaaS", async () => {
    const { findByText } = renderHub(true);
    expect(await findByText("Marketplace")).toBeTruthy();
  });

  it("omits the Marketplace tile in standalone", async () => {
    const { findByText, queryByText } = renderHub(false);
    // Wait for the hub to actually be on screen before asserting an absence.
    await findByText("Templates");
    expect(queryByText("Marketplace")).toBeNull();
  });
});

describe("marketplace route", () => {
  it("404s in standalone rather than rendering an empty catalogue", async () => {
    const thrown = await marketplaceLoader({
      request: new Request("https://example.test/library/marketplace"),
      context: createLoadContext({ APP_MODE: "standalone" }),
      params: {},
    } as never).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });
});
