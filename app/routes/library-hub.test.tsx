// @vitest-environment happy-dom
/**
 * The Marketplace tile is gated on a deployment CAPABILITY.
 *
 * Where the catalogue does not exist there is no way for one to arrive, so the
 * tile led to a permanently empty page — the "Marketplace is empty" screen the
 * content-delivery spec exists because of. Two halves, both asserted here: the
 * tile is not offered, and the route itself refuses rather than rendering an
 * empty list (a 404 is the honest answer to a page that cannot have content).
 *
 * The hub used to read `branding.isSaas` while `marketplace.tsx` enforced
 * `hasContentMarketplace` — one question, two answers. The cause was not
 * carelessness: the capability was not on the session-context payload at all,
 * so `isSaas` was the only reachable approximation. The last test below is the
 * one that can tell those two implementations apart.
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

function renderHub(ctx: { isSaas: boolean; hasContentMarketplace: boolean }) {
  const Stub = createRoutesStub([
    {
      // The id `useSessionContext` reads through `useRouteLoaderData`.
      id: "routes/auth-layout",
      path: "/",
      loader: () => ({
        context: {
          branding: { isSaas: ctx.isSaas },
          deployment: { hasContentMarketplace: ctx.hasContentMarketplace },
        },
      }),
      Component: () => <Outlet />,
      children: [{ path: "library", Component: LibraryHub }],
    },
  ]);
  return render(<Stub initialEntries={["/library"]} />);
}

describe("library hub marketplace tile", () => {
  it("offers the Marketplace tile where the catalogue exists", async () => {
    const { findByText } = renderHub({ isSaas: true, hasContentMarketplace: true });
    expect(await findByText("Marketplace")).toBeTruthy();
  });

  it("omits the Marketplace tile where it does not", async () => {
    const { findByText, queryByText } = renderHub({ isSaas: false, hasContentMarketplace: false });
    // Wait for the hub to actually be on screen before asserting an absence.
    await findByText("Templates");
    expect(queryByText("Marketplace")).toBeNull();
  });

  it("survives a session context that carries no deployment block at all", async () => {
    // Fail closed means HIDE the tile, not crash the route. `?.deployment.x`
    // guards the context and not the block, so a payload written before the
    // capability shipped — every older fixture, and any cached session from a
    // previous deploy — threw on the property access and replaced the page with
    // "Unexpected Application Error!". The existing CommandPalette test caught
    // this only because its fixture happened to omit the block; this one says so
    // on purpose.
    const Stub = createRoutesStub([
      {
        id: "routes/auth-layout",
        path: "/",
        loader: () => ({ context: { branding: { isSaas: true } } }),
        Component: () => <Outlet />,
        children: [{ path: "library", Component: LibraryHub }],
      },
    ]);
    const { findByText, queryByText } = render(<Stub initialEntries={["/library"]} />);
    await findByText("Templates");
    expect(queryByText("Marketplace")).toBeNull();
  });

  it("follows the capability when the capability and the mode disagree", async () => {
    // The only test here that can fail for the right reason. The two above pass
    // against BOTH implementations, because a session where `isSaas` and
    // `hasContentMarketplace` agree cannot say which one was read. Making them
    // contradict each other is the whole point — and this is the shape the
    // marketplace unification work (OI #293) will actually produce, where a
    // standalone deployment gains a catalogue.
    const { findByText, queryByText } = renderHub({ isSaas: true, hasContentMarketplace: false });
    await findByText("Templates");
    expect(queryByText("Marketplace")).toBeNull();
  });
});

describe("marketplace route", () => {
  it("404s where there is no catalogue, rather than rendering an empty one", async () => {
    const thrown = await marketplaceLoader({
      request: new Request("https://example.test/library/marketplace"),
      context: createLoadContext({ APP_MODE: "standalone" }),
      params: {},
    } as never).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });
});
