// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { hasOpenLayer } from "@core/shared-ui";
import { KeyboardHud } from "~/components/editor/KeyboardHud";
import { VersionCompare } from "~/components/collab/VersionCompare";
import { UserMenuPopover } from "~/components/sidebar/UserMenuPopover";

afterEach(() => {
  cleanup();
  expect(hasOpenLayer()).toBe(false);
});

const esc = () => fireEvent.keyDown(document, { key: "Escape" });

describe("Escape on layer-backed overlays", () => {
  it("KeyboardHud closes on Escape and leaves the stack when unmounted", () => {
    const onClose = vi.fn();
    render(<KeyboardHud onClose={onClose} />);
    expect(hasOpenLayer()).toBe(true);
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const compare = (busy: boolean, onClose: () => void) => (
    <VersionCompare open onClose={onClose} fromLabel="v1" toLabel="Current" diffs={[]} busy={busy} />
  );

  it("VersionCompare closes on Escape", () => {
    const onClose = vi.fn();
    render(compare(false, onClose));
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("VersionCompare ignores Escape while a write is in flight", () => {
    const onClose = vi.fn();
    render(compare(true, onClose));
    esc();
    expect(onClose).not.toHaveBeenCalled();
  });

  const menu = (open: boolean, onClose: () => void) => {
    const router = createMemoryRouter(
      [
        {
          id: "root",
          path: "/",
          element: <UserMenuPopover open={open} onClose={onClose} companyName="Acme" tenantSlug="acme" showSwitchWorkspace={false} />,
        },
      ],
      { hydrationData: { loaderData: { root: null } } },
    );
    return <RouterProvider router={router} />;
  };

  it("UserMenuPopover closes on Escape while open", () => {
    const onClose = vi.fn();
    render(menu(true, onClose));
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("UserMenuPopover does not answer Escape while closed", () => {
    const onClose = vi.fn();
    render(menu(false, onClose));
    esc();
    expect(onClose).not.toHaveBeenCalled();
  });
});
