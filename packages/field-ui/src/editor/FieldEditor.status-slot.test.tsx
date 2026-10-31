// @vitest-environment happy-dom
/** The phone and tablet app bars carry the host's `renderStatus` next to the save indicator, and nothing extra without it. */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { mountForRatings } from "./FieldEditor.rating.fixtures";

afterEach(cleanup);

describe.each([["tablet", 834], ["phone", 390]] as const)("%s: status slot", (_tree, width) => {
  it("renders the host status in the app bar status area", async () => {
    mountForRatings(width, { slots: { renderStatus: () => <span data-testid="host-status">Offline</span> } });
    const bar = await screen.findByRole("banner");
    expect(within(bar).getAllByTestId("host-status")).toHaveLength(1);
    expect(within(within(bar).getByTestId("app-bar-status")).getByTestId("host-status")).toBeTruthy();
  });

  it("CONTROL - without the slot the status area holds no host element", async () => {
    mountForRatings(width);
    const bar = await screen.findByRole("banner");
    expect(within(bar).queryByTestId("host-status")).toBeNull();
    expect(within(bar).getByTestId("app-bar-status").children).toHaveLength(0);
  });
});
