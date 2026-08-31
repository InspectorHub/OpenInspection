// @vitest-environment happy-dom
/**
 * The Marketplace door is open in EVERY deployment mode.
 *
 * It used to be gated twice over — the hub tile on `branding.isSaas`, the route
 * on a deployment capability — because a standalone catalogue was believed to
 * be permanently empty. It never was: the starter-content seeder fills
 * `marketplace_libraries` from this repository's own fixtures in both modes,
 * and its caller is gated on role rather than on mode. A self-hosted operator
 * therefore had a populated catalogue behind a 404 and could install nothing.
 *
 * What stays mode-specific is PUBLISHING a catalogue row across workspaces,
 * which lives under `server/portal/` and is mounted only where the M2M surface
 * is. Nothing in this file touches that, and nothing here should: browsing and
 * publishing are different verbs with opposite standalone answers, and one flag
 * answering both is the fault these tests were rewritten for.
 *
 * The API handlers under `server/api/marketplace.ts` were ungated in both modes
 * throughout, which is why the page was the only thing that had to change.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";

import LibraryHub from "~/routes/library-hub";
import { loader as marketplaceLoader } from "~/routes/marketplace";
import { createLoadContext } from "~/lib/load-context";

function renderHub(ctx: { isSaas: boolean }) {
  const Stub = createRoutesStub([
    {
      // The id `useSessionContext` reads through `useRouteLoaderData`.
      id: "routes/auth-layout",
      path: "/",
      loader: () => ({
        context: { branding: { isSaas: ctx.isSaas }, deployment: { mode: ctx.isSaas ? "saas" : "standalone" } },
      }),
      Component: () => <Outlet />,
      children: [{ path: "library", Component: LibraryHub }],
    },
  ]);
  return render(<Stub initialEntries={["/library"]} />);
}

describe("library hub marketplace tile", () => {
  it("offers the Marketplace tile on a hosted session", async () => {
    const { findByText } = renderHub({ isSaas: true });
    expect(await findByText("Marketplace")).toBeTruthy();
  });

  it("offers it on a SELF-HOSTED session too — the case the old gate hid", async () => {
    // The one assertion here that can fail for the right reason. The test above
    // passes against the old `isSaas`/capability gate as well, because a hosted
    // session was always shown the tile; only a standalone session can tell the
    // two implementations apart.
    const { findByText } = renderHub({ isSaas: false });
    expect(await findByText("Marketplace")).toBeTruthy();
  });

  it("does not depend on the session context at all", async () => {
    // The hub reads no deployment capability any more, so it must render the
    // full set of tiles with no auth-layout payload whatsoever. Asserted rather
    // than assumed: re-introducing a `useSessionContext()?.deployment.x` read
    // without a null guard threw on the property access and replaced the whole
    // page with "Unexpected Application Error!", which is how the previous
    // version of this file came to have a test about crashing.
    const Stub = createRoutesStub([
      {
        id: "routes/auth-layout",
        path: "/",
        loader: () => ({ context: {} }),
        Component: () => <Outlet />,
        children: [{ path: "library", Component: LibraryHub }],
      },
    ]);
    const { findByText } = render(<Stub initialEntries={["/library"]} />);
    await findByText("Templates");
    expect(await findByText("Marketplace")).toBeTruthy();
  });
});

describe("marketplace route", () => {
  it("does not 404 in standalone — it asks who is signed in, like every other page", async () => {
    const thrown = await marketplaceLoader({
      request: new Request("https://example.test/library/marketplace"),
      context: createLoadContext({ APP_MODE: "standalone" }),
      params: {},
    } as never).catch((e: unknown) => e);

    // A 302 to the login page, not a 404. Asserting only "not 404" would be
    // satisfied by a loader that threw a 500 on the way past the removed gate,
    // which is the failure that looks like success here: the door is unlocked
    // and the room is on fire. The redirect proves it reached `requireToken`,
    // which is exactly as far as an unauthenticated request should get.
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("location")).toContain("/login");
  });
});
