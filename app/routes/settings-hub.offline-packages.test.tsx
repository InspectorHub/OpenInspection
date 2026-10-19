// @vitest-environment happy-dom
/**
 * The doors to the offline-package import page: a Settings hub tile for owners
 * and managers only, and a command palette entry that goes to the same address.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub, Outlet } from "react-router";
import SettingsHub from "~/routes/settings-hub";
import { getSettings } from "~/components/command-palette-items";

function renderHub(role: string) {
  const context = {
    branding: { defaultLocale: "en-US", defaultTimezone: "UTC", isSaas: false },
    user: { role, capabilities: {} },
    deployment: { mode: "standalone", hasBilling: false, hasSeatQuota: false, mcpEnabled: false, connectedAppsEnabled: false },
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

describe("Settings hub, Offline packages tile", () => {
  it.each(["owner", "manager"])("is shown to a %s and goes to the import page", async (role) => {
    renderHub(role);
    expect(await screen.findByRole("link", { name: /Offline packages/ })).toHaveProperty("pathname", "/settings/offline-packages");
  });

  it("is not shown to an inspector, while the hub itself renders", async () => {
    renderHub("inspector");
    expect(await screen.findAllByRole("link")).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: /Offline packages/ })).toBeNull();
  });
});

describe("command palette", () => {
  it("offers the import page", () => {
    const item = getSettings().find((entry) => entry.to === "/settings/offline-packages");
    expect(item?.label).toBe("Settings - Import offline package");
    // The data page entry next to it is untouched (control).
    expect(getSettings().find((entry) => entry.to === "/settings/data")).toBeTruthy();
  });
});
