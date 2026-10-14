// @vitest-environment happy-dom
/**
 * The Connected applications tile on the Settings hub.
 *
 * The page lists OAuth grants of both kinds, remote MCP clients and native app
 * sign-ins, and the grant routes serve either. The tile used to follow the MCP
 * switch alone, so a deployment that turned on only native clients had grants it
 * could revoke through the API but no way to reach them from Settings. It now
 * follows `connectedAppsEnabled`, which is true when either consumer is on.
 *
 * Drives the real route with the deployment payloads and reads the links a
 * reader would see. Every "hidden" case is paired with a "shown" one.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import SettingsHub from "~/routes/settings-hub";

function renderHub(deployment: { mcpEnabled: boolean; connectedAppsEnabled: boolean }) {
  const context = {
    branding: { defaultLocale: "en-US", defaultTimezone: "UTC", isSaas: false },
    user: { role: "owner", capabilities: {} },
    deployment: { mode: "standalone", hasBilling: false, hasSeatQuota: false, ...deployment },
  };
  const Stub = createRoutesStub([
    {
      id: "routes/auth-layout",
      path: "/",
      loader: () => ({ context }),
      Component: () => <Outlet />,
      children: [{ path: "settings", Component: SettingsHub }],
    },
  ]);
  return render(<Stub initialEntries={["/settings"]} />);
}

const connectedAppsLink = () => screen.queryByRole("link", { name: /Connected applications/ });

describe("Settings hub, Connected applications tile", () => {
  it("is shown when only native clients are on", async () => {
    renderHub({ mcpEnabled: false, connectedAppsEnabled: true });
    expect(await screen.findByRole("link", { name: /Connected applications/ })).toHaveProperty("pathname", "/settings/connected-apps");
  });

  it("is shown when only MCP is on", async () => {
    renderHub({ mcpEnabled: true, connectedAppsEnabled: true });
    expect(await screen.findByRole("link", { name: /Connected applications/ })).toBeTruthy();
  });

  it("is hidden when neither is on, while the rest of the hub renders", async () => {
    renderHub({ mcpEnabled: false, connectedAppsEnabled: false });
    // The hub itself rendered (control), without the tile.
    expect(await screen.findAllByRole("link")).not.toHaveLength(0);
    expect(connectedAppsLink()).toBeNull();
  });
});
